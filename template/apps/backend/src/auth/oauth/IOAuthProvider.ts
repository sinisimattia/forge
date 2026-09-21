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
 *
 * **`authorizationUrl` returns `Promise<string>`, not `string`.** Building the
 * URL itself is pure string work for every adapter, and for two of the three
 * (`GoogleOAuthProvider`, `DevOAuthProvider`) that is the whole of it — neither
 * does any I/O to answer this method, and `async` on them is nothing more than
 * the keyword. The third, `OidcOAuthProvider`, does not have that luxury: it
 * has no authorization endpoint of its own to build a URL from until it has
 * fetched the issuer's discovery document, and that is a network call. Making
 * every implementation's method asynchronous, rather than carving out a
 * synchronous exception for two adapters and an asynchronous one for the
 * third, keeps this a single contract with one shape — a caller awaits once,
 * regardless of which adapter is behind it, instead of needing to know which
 * providers happen to require a network round trip before they can answer.
 * The alternative — a synchronous signature plus an adapter-specific
 * "call this first" warm-up step with no place in the port for the compiler
 * or a test to see it — was tried and rejected: a deployment that forgot the
 * warm-up call would boot cleanly and fail only when the first person clicked
 * "sign in," which is exactly the "button that fails when someone presses it"
 * ADR-0008 rules out for an unconfigured provider, reintroduced here for a
 * configured one instead.
 */
export interface IOAuthProvider {
  /** Which provider this is. Never `AuthProvider.PASSWORD`. */
  readonly provider: AuthProvider;
  /** @returns the absolute URL to send the browser to */
  authorizationUrl(params: AuthorizationUrlParams): Promise<string>;
  /** @returns what the provider asserts about the account that just approved this */
  fetchAccount(params: ExchangeParams): Promise<FederatedAccount>;
}

/** The multi-provider token. Every registered adapter is injected as one array. */
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
