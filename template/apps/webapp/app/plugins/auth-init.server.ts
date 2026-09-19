import { createApiClient } from '~/fetchers';
import { useAuthStore } from '~/stores/auth';

/**
 * Re-establishes the session once per server-rendered request, before anything
 * renders.
 *
 * **Nuxt registers this by where the file is, and nothing imports it.** Two
 * halves of that matter independently: `app/plugins/` is what makes it run at
 * all, and the `.server` in the name is what keeps it off the client, where
 * `useRequestHeaders` has nothing to read and a second renewal per page load is
 * exactly the concurrent rotation `renew` exists to prevent. Deleting or
 * renaming this file changes the running application and would be invisible to
 * any spec that imported a function out of it — which is why its spec imports
 * **this path** and drives the plugin Nuxt would have registered.
 *
 * It is `async`, and Nuxt awaits it. That is the point: the render must not
 * begin until the question "is anybody signed in" has an answer, or every
 * protected page ships its signed-out markup and corrects it after hydration.
 *
 * ## Hazard one: the cookie does not travel by itself
 *
 * The renewal credential is a cookie, and here there is no browser to send it.
 * The request is issued by a Node process that was *handed* one; unless this
 * code copies the incoming `cookie` header onto the outgoing request, the
 * renewal goes out bare, the backend answers `401`, and the symptom is "SSR
 * never sees a signed-in user" with no error logged anywhere, because a `401`
 * from a renewal is the ordinary way of saying "nobody is signed in".
 *
 * ## Hazard two: the new cookie does not come back by itself
 *
 * A renewal **rotates**. The answer carries a new cookie and the old one is
 * spent. In Node nothing stores it, so unless these values are relayed onto the
 * response being built, the server keeps the new credential in a variable it
 * throws away and the browser is left holding the spent one. The next renewal
 * presents it, the backend's reuse detection reads that as a stolen credential —
 * correctly — and revokes the whole session family. From the person's side that
 * is indistinguishable from hazard one: they are signed out at random.
 *
 * Both are written down because this file looks like four lines of ceremony and
 * somebody will simplify it.
 */
export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig();
  const store = useAuthStore();

  // The whole header, not a parsed one. Anything this process cannot read is
  // still the backend's to read, and `httpOnly` means the interesting part is
  // exactly the part script may not parse.
  const incoming = useRequestHeaders(['cookie']).cookie;
  const outgoing = useResponseHeader('set-cookie');

  store.adoptTransport(createApiClient({
    // The backend answers on a different address from inside the deployment
    // than it does from a browser — see `runtimeConfig.apiBaseServer`.
    baseUrl: config.apiBaseServer === '' ? config.public.apiBase : config.apiBaseServer,
    credential: () => store.accessToken,
    headers: (): Record<string, string> => (incoming === undefined ? {} : { cookie: incoming }),
    onSetCookie: relay,
  }));

  await store.initialize();

  if (store.isAuthenticated) {
    // This response's payload now contains a bearer credential, because the
    // store's state travels to the browser in it — see `stores/auth.ts`. Saying
    // so out loud is what keeps a shared cache from handing one person's
    // credential to the next visitor who asks for the same URL.
    useResponseHeader('cache-control').value = 'private, no-store';
  }

  /** Adds to the response's `Set-Cookie`, keeping whatever is already there. */
  function relay(values: readonly string[]): void {
    if (values.length === 0) return;
    const held = outgoing.value;
    // `Set-Cookie` is the one header that may legally repeat, so this appends
    // rather than assigns: a renewal that rotates two cookies, or a response
    // that already carried one, must not lose either.
    const current = held === undefined ? [] : Array.isArray(held) ? held : [String(held)];
    outgoing.value = [...current, ...values];
  }
});
