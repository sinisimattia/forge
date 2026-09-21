import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';

/** Where the browser is sent, and what it must bring back. */
export interface AuthorizationUrlParams {
  /** The single-use value tying the callback to the request that began it. */
  readonly state: string;
  /** The PKCE challenge — the verifier's digest, never the verifier. */
  readonly codeChallenge: string;
  /** Where the provider returns the browser. A deployment-configured origin. */
  readonly redirectUri: string;
}

/** What the callback presents in exchange for the account behind it. */
export interface ExchangeParams {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/**
 * One federated provider, stated as the capability rather than as a vendor.
 *
 * **Two methods, and the asymmetry between them is the security boundary.**
 * `authorizationUrl` builds a string the *browser* carries; nothing it returns
 * is trusted, because everything in it travels through a user agent that may
 * rewrite it. `fetchAccount` speaks to the provider directly, server to server,
 * over TLS, and what it returns is what this application acts on.
 *
 * That asymmetry is also why there is no ID-token verification anywhere behind
 * this port (ADR-0011): the access credential used to read the account was
 * obtained by this process from the provider's own endpoint, so the claim's
 * path of custody never included the browser. Verifying a signature would be
 * re-establishing a property the transport already gives, at the cost of JWKS
 * fetching, key rotation and algorithm selection — three surfaces this template
 * does not need to own.
 *
 * An implementation returns a {@link FederatedAccount} and **nothing else**: no
 * access credential, no refresh credential, no raw provider payload. A provider
 * credential this application keeps is a provider credential this application
 * can leak, and nothing here needs one after the exchange.
 */
export interface IOAuthProvider {
  /** Which provider this is. Never `AuthProvider.PASSWORD`. */
  readonly provider: AuthProvider;
  /** @returns the absolute URL to send the browser to */
  authorizationUrl(params: AuthorizationUrlParams): string;
  /** @returns what the provider asserts about the account that just approved this */
  fetchAccount(params: ExchangeParams): Promise<FederatedAccount>;
}

/** The multi-provider token. Every registered adapter is injected as one array. */
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
