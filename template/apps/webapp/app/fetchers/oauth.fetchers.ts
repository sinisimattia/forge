import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { ApiClient } from '~/types';

/**
 * The federated flow's endpoints — plus one function that is not an endpoint
 * at all.
 *
 * `getOAuthProviders` and `postBeginLink` are ordinary fetchers: they issue a
 * request and return the parsed body, nothing else. `authorizationPathFor` is
 * not, and lives here anyway, because this is the file where a path is
 * spelled and that is all it does — see its own TSDoc for why it must never
 * become a third fetcher.
 */

/**
 * Every provider this deployment configured.
 *
 * Public — there is no session yet for whoever is reading a login page — and
 * an empty list is a normal answer, never an error: an unconfigured provider
 * is simply absent from what this returns (ADR-0008).
 */
export async function getOAuthProviders(client: ApiClient): Promise<AuthProvider[]> {
  const { providers } = await client<{ providers: AuthProvider[] }>({
    method: 'GET',
    path: '/auth/oauth/providers',
  });
  return providers;
}

/**
 * Begins linking `provider` to the actor's own account.
 *
 * **This one is a `fetch`, and carries the actor's access credential exactly
 * like any other authenticated request this webapp makes** — the transport
 * attaches whatever credential it currently holds, and the backend resolves
 * the actor from it, the same as `deleteIdentity` or `postChangePassword`.
 * That is the whole reason this route exists rather than reusing
 * `authorizationPathFor`'s target for linking too: only an authenticated
 * `fetch` can carry that credential, and a top-level browser navigation
 * cannot. The JSON reply carries the authorization URL, not a redirect,
 * because a `fetch` response is read by this function's own caller and never
 * followed by the browser.
 *
 * @param client - the transport to issue through
 * @param provider - which provider to link
 * @returns the authorization URL the caller must navigate the browser to
 */
export async function postBeginLink(client: ApiClient, provider: AuthProvider): Promise<string> {
  const { authorizationUrl } = await client<{ authorizationUrl: string }>({
    method: 'POST',
    path: `/users/me/identities/${provider}`,
  });
  return authorizationUrl;
}

/**
 * The path the browser is sent to in order to begin a federated sign-in.
 *
 * **This is a path to assign to `window.location`, and it must never become a
 * `fetch`.** Signing in with a federated provider means the browser has to
 * leave this application's own origin — Google, GitHub or the deployment's
 * OIDC provider renders its own consent screen and collects its own
 * credential, and only a real top-level navigation can land the browser
 * there and later be the thing the provider's own `302` carries it back
 * through. A `fetch` cannot do either half of that: it has no way to
 * navigate the browser away from the page that issued it, and even a request
 * that somehow reached the provider's origin would be blocked by CORS before
 * any consent screen was ever shown to the person. So this function issues
 * nothing — it is a pure string builder, and the one thing about this module
 * that reads like an oversight if that is not written down somewhere a
 * future reader will see it before "fixing" it into a fetch.
 *
 * The path is relative to the **backend's** origin, not this application's —
 * the caller (a composable, not this file) is what knows the configured API
 * base and is responsible for resolving this against it before navigating.
 *
 * @param provider - which provider to sign in with
 * @param redirectTo - where the browser should land once sign-in completes,
 * or `null` for the backend's own default
 * @returns the backend path to navigate the browser to
 */
export function authorizationPathFor(provider: AuthProvider, redirectTo: string | null): string {
  const path = `/auth/oauth/${provider}`;
  if (redirectTo === null || redirectTo === '') return path;
  return `${path}?redirectTo=${encodeURIComponent(redirectTo)}`;
}
