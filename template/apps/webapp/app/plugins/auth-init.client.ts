import { useAuthStore } from '~/stores/auth';

/**
 * Earns the browser its own access credential, once, on hydration.
 *
 * The server's half of this — `plugins/auth-init.server.ts` — renews per
 * server-rendered request and keeps the credential in the render's memory. It
 * does not travel: the store's state is what Nuxt serialises into the payload,
 * and the credential is deliberately not state (see `stores/auth.ts` →
 * `heldCredential`). What crosses is `status` and the person, which is all the
 * no-flash behaviour ever needed. This is the other half, and without it the
 * browser believes in a session it can never present.
 *
 * **Nuxt registers this by where the file is, and nothing imports it** — the same
 * two independent halves the server plugin's comment sets out. `app/plugins/` is
 * what makes it run; the `.client` in the name is what keeps it off the server,
 * where it would be a second renewal inside the one render that just renewed,
 * against a cookie that render has already rotated. Its spec imports **this
 * path** for that reason.
 *
 * ## The race, which is the reason for `dependsOn` and for the `if`
 *
 * A renewal rotates, and the backend's reuse detection revokes the entire
 * session family when a spent credential comes back. It is right to: that is
 * what a stolen one looks like. So a client renewal must happen strictly after
 * the server's rotation has **landed** — both halves of landed:
 *
 * 1. **The rotated cookie is in the jar.** It arrives as `Set-Cookie` on the
 *    document response, and the browser commits response headers before it runs
 *    a single byte of script from that document. That half the platform gives
 *    us, and it is the reason this can be a plugin at all.
 * 2. **The rotation's *outcome* is in this store.** That half is not given.
 *    `@pinia/nuxt` copies `nuxtApp.payload.pinia` into `pinia.state.value` in
 *    its own plugin's `setup`, and Nuxt runs plugins in order. Run before it,
 *    `useAuthStore()` here builds a **fresh** store — `status: 'unknown'` — and
 *    a plugin that renewed unconditionally would spend a rotation and then have
 *    its result overwritten wholesale by pinia's `pinia.state.value = payload`.
 *    The browser would be left holding a cookie the server had already spent,
 *    and the next renewal — the first one any page makes — would present it.
 *    Reuse detection would revoke the family and sign out a visitor who did
 *    nothing wrong, on a code path where nothing looked unusual.
 *
 * `dependsOn: ['pinia']` names the plugin that does the copying (it declares
 * `name: 'pinia'`), so Nuxt orders this after it. The `if` is the belt to that
 * brace and is what actually holds: `status === 'authenticated'` is unreachable
 * on a store pinia has not hydrated, because a fresh one starts at `unknown` and
 * only a successful renewal moves it. So if the ordering were ever lost, this
 * renews **nothing** rather than renewing too early — the failure is a missing
 * credential, which `utils/authFetch.ts` recovers from on the first `401`, and
 * not a revoked session, which nothing recovers from.
 *
 * ## Why it is awaited, and why that is not a flash
 *
 * Nuxt waits for an async plugin before it mounts, so every request the
 * application makes afterwards presents a credential instead of discovering it
 * is missing. Nothing blanks in the meantime: the server-rendered markup is
 * already on screen and already says the visitor is signed in. The credential
 * was never what prevented the flash — the three-state `status` is.
 *
 * **The `await` is unbounded here on purpose — the bound lives one layer down.**
 * A *down* backend answers (or refuses to connect) quickly and this settles
 * either way; a *hung* one would otherwise leave this `await`, and therefore
 * Nuxt's mount, waiting forever on an already-rendered page. `renew` goes out on
 * `createApiClient` (`fetchers/client.ts`), which bounds every request it makes
 * with `DEFAULT_API_TIMEOUT_MS` — read that constant's own documentation for why
 * the bound belongs to the shared transport and not to a race written out again
 * at every `await` that could hang the same way. When it fires here, the
 * rejection reaches `attemptRenewal`'s existing catch-all exactly as a refused
 * renewal already does: `forget()` runs, `status` becomes `anonymous`, and a
 * visitor whose backend was merely slow lands where a visitor whose renewal was
 * refused already does — signed out, on a page still on screen, free to sign in
 * again.
 *
 * ## Why it does not ask when the status is `unknown`
 *
 * That is a page nothing server-rendered a session for, so there is no rotation
 * to come after and nothing here knows whether to expect one. The route
 * middleware's `initialize()` is what asks in that case, exactly as it did
 * before, and asking here too would renew on pages that have no guard at all.
 */
export default defineNuxtPlugin({
  name: 'auth-init-client',
  // `@pinia/nuxt`'s own plugin, by the name it declares. It is what puts the
  // server render's answer into this store, and renewing before it is the
  // family-revoking race above.
  dependsOn: ['pinia'],
  async setup() {
    const store = useAuthStore();
    // The one state the SSR payload can now produce: a session we believe in and
    // hold nothing for. Anything else — `unknown`, `anonymous`, or a credential
    // already in hand — is not ours to renew.
    if (store.status !== 'authenticated' || store.accessToken !== null) return;
    await store.renew();
  },
});
