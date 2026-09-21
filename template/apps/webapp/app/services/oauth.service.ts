import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { getOAuthProviders, postBeginLink } from '~/fetchers';
import type { ApiClient } from '~/types';

/**
 * The federated flow's client half: listing what this deployment configured,
 * and beginning an authenticated link.
 *
 * **This is not an `I*Service` implementation, and that is deliberate
 * (DEC-1).** `IIdentityService`'s own TSDoc says that linking a new identity
 * is not part of that contract, because an identity comes into being
 * alongside the proof it stands for — a capability of whichever side holds
 * that proof, not of the contract that only reads and unlinks what already
 * exists. A federated authorization is that proof arriving over a transport,
 * so its contract is the backend's route surface, not a core interface.
 *
 * Putting `listProviders`/`beginLink` on `IIdentityService` would give every
 * implementation of that contract a redirect to perform that only the side
 * holding an OAuth client secret and a registered adapter can honestly
 * perform. This webapp's implementation could satisfy it — it is the one
 * doing the redirecting — but any other implementation of the same contract
 * would have nothing to redirect to and would have to fabricate a URL, or a
 * lie dressed as one. That is exactly the defect the conformance split
 * (DEC-1) exists to prevent: an assertion only the implementation that owns
 * the flow can honestly satisfy does not belong in the shared suite. So this
 * class stands alone, with no `I*Service` held against it and no shared
 * conformance suite driving it — `oauth.service.spec.ts` is this class's
 * entire proof, the same way `AuthHttpService.takeIssuedCredential` (a
 * webapp-only method on no contract) is proven only by
 * `auth.service.seam.spec.ts`.
 *
 * Signing in is deliberately not a method here either, for a related but
 * separate reason: see `authorizationPathFor` in `~/fetchers` (re-exported
 * below) — it is a `window.location` target, not a request this class could
 * issue, because it never issues a request at all.
 */
export class OAuthHttpService {
  private readonly client: ApiClient;

  /** @param client - the transport the fetchers issue through */
  public constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Every provider this deployment configured.
   *
   * Public — there is no session yet for whoever is reading a login page —
   * and an empty list is a normal answer, never an error.
   */
  public async listProviders(): Promise<AuthProvider[]> {
    return getOAuthProviders(this.client);
  }

  /**
   * Begins linking `provider` to the actor's own account.
   *
   * **The one call on this class that is a `fetch`, and it must stay one.**
   * It is authenticated: the transport attaches whatever credential it
   * currently holds and the backend resolves the actor from it — nothing on
   * this side names who is asking, the same way `createApiClient` ignores
   * `ApiRequest.actor` for every other authenticated call this webapp makes.
   * The caller of this method reads the URL this resolves with and navigates
   * the browser to it itself, with `window.location`, never with another
   * `fetch` — that hand-off to the provider's own origin is the one thing a
   * `fetch` cannot do, which is the whole reason `beginLink` answers with a
   * URL instead of a redirect.
   *
   * @param provider - which provider to link
   * @returns the authorization URL to navigate the browser to
   */
  public async beginLink(provider: AuthProvider): Promise<string> {
    return postBeginLink(this.client, provider);
  }
}

export { authorizationPathFor } from '~/fetchers';
