import { useAuthStore } from '~/stores/auth';
import { SIGN_IN_PATH } from '~/utils/redirect';

/**
 * Lets a signed-in visitor through, and sends everybody else to sign in.
 *
 * Declared by a page as `definePageMeta({ middleware: 'auth' })`. **Nuxt finds
 * it by the name of this file** — nothing imports it — so renaming the file
 * silently unprotects every page that named it. That is what
 * `middleware/__tests__/auth.spec.ts` is written to catch: it imports this exact
 * path, so the file moving is a red test rather than an unguarded page.
 *
 * ## Why it awaits before it decides
 *
 * The access credential lives in memory (DEC-3), so a full page load starts with
 * nothing and the store's `status` starts at `unknown`. A guard that read
 * `isAuthenticated` at that moment would find `false` for **everyone**, on every
 * hard refresh, and bounce a signed-in person to the sign-in page. So it asks
 * the question first — `initialize()`, which is one renewal however many guards
 * call it — and only then decides.
 *
 * ## The `redirect` it writes, and the one it does not read
 *
 * `to.fullPath` comes from the router, which is why it is passed on without
 * being judged: it is a route this application resolved, and it cannot be an
 * absolute or protocol-relative URL. Judging happens where the value is
 * **consumed** and is therefore attacker-supplied — `middleware/guest.ts` and
 * the sign-in page — both of which put it through `localRedirect`.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const store = useAuthStore();
  await store.initialize();
  if (store.isAuthenticated) return;
  return navigateTo({ path: SIGN_IN_PATH, query: { redirect: to.fullPath } });
});
