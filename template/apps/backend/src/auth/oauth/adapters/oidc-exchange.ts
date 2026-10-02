import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { AuthorizationUrlParams, ExchangeParams } from '../IOAuthProvider';

/**
 * What a deployment registered for one federated provider. Never logged, never
 * persisted, never returned from anything behind `IOAuthProvider` — an
 * adapter holds this only long enough to spend it against the provider's own
 * endpoints.
 */
export interface OAuthClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The two endpoints {@link exchangeForAccount} speaks to. A provider may publish more; this is all this exchange reads. */
export interface OidcExchangeEndpoints {
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint: string;
}

/**
 * Builds the URL the browser is sent to. Shared because every adapter behind
 * `IOAuthProvider` that speaks plain OIDC asks for exactly this shape — only
 * the authorization endpoint and the client id vary, and both are the
 * caller's to supply.
 *
 * `code_challenge_method` is always `S256`: PKCE's `plain` method exists only
 * for a client unable to compute SHA-256, which nothing this template runs on
 * is.
 */
export function buildAuthorizationUrl(
  authorizationEndpoint: string,
  clientId: string,
  params: AuthorizationUrlParams,
): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    scope: 'openid email profile',
  });
  // The `?` join assumes `authorizationEndpoint` carries no query of its own.
  return `${authorizationEndpoint}?${query.toString()}`;
}

/**
 * The exchange every OIDC adapter behind `IOAuthProvider` performs: redeem an
 * authorization code for an access credential at the token endpoint, then
 * read the account it belongs to at the userinfo endpoint. `GoogleOAuthProvider`
 * and `OidcOAuthProvider` differ only in which three endpoints they hand this
 * function — the exchange itself, and the security properties it must hold,
 * do not vary by provider, which is why this lives once rather than as two
 * copies that could drift.
 *
 * **The client secret travels in the POST body, never the URL.** A secret in
 * a query string is a secret in every proxy log between here and the
 * provider.
 *
 * **No ID-token verification happens here, and none is missing.** The access
 * credential this function reads the account with was obtained directly from
 * the provider's own token endpoint, over TLS, by this process — never by the
 * browser — so its path of custody never included a party this application
 * does not already trust. Verifying a signature on top of that would
 * re-establish a property the transport already gives, at the cost of JWKS
 * fetching, key rotation and algorithm selection (see `IOAuthProvider`'s own
 * note, ADR-0011).
 *
 * **`email_verified` is read only when it is the literal boolean `true`.**
 * Anything else — `false`, a string, a number, or the field's absence — comes
 * out as `emailVerified: false`. This is the single most important line in
 * this function: a provider genuinely does send `email_verified: false` for
 * an address it has not itself proven, and coercing, defaulting, or omitting
 * that check would turn D11 — a provider-asserted address must not link to
 * an existing account on its say-so alone — into a silent sign-in.
 *
 * **A userinfo response with no subject identifies nobody.** `sub` must be a
 * non-empty string or this throws before returning anything — an identity
 * keyed on an empty string is an identity every such response would match.
 *
 * Every other field is read, never coerced: an absent `email` or `name` is
 * `null`, not `''` or a guess.
 */
export async function exchangeForAccount(
  provider: AuthProvider,
  endpoints: OidcExchangeEndpoints,
  credentials: OAuthClientCredentials,
  params: ExchangeParams,
  http: typeof fetch,
): Promise<FederatedAccount> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  const tokenResponse = await http(endpoints.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenResponse.ok) {
    throw new Error(`${provider}: token endpoint answered ${tokenResponse.status}.`);
  }

  const token = await tokenResponse.json() as Record<string, unknown>;
  const accessToken = token.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error(`${provider}: token endpoint response carried no access token.`);
  }

  const userinfoResponse = await http(endpoints.userinfoEndpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!userinfoResponse.ok) {
    throw new Error(`${provider}: userinfo endpoint answered ${userinfoResponse.status}.`);
  }

  const userinfo = await userinfoResponse.json() as Record<string, unknown>;

  const subject = userinfo.sub;
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new Error(`${provider}: userinfo response carried no subject.`);
  }

  const email = typeof userinfo.email === 'string' ? userinfo.email : null;
  const displayName = typeof userinfo.name === 'string' ? userinfo.name : null;

  return {
    provider,
    subject,
    email,
    // Strict identity, not truthiness: only the literal boolean `true` counts
    // as verified. See this function's own doc for why every other shape —
    // including simple absence — must come out `false`.
    emailVerified: userinfo.email_verified === true,
    displayName,
  };
}
