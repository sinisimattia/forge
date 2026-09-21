import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { AuthorizationUrlParams, ExchangeParams, IOAuthProvider } from '../IOAuthProvider';
import { buildAuthorizationUrl, exchangeForAccount } from './oidc-exchange';
import type { OAuthClientCredentials } from './oidc-exchange';

/** Google's own OpenID Connect endpoints — published, stable, and never discovered. */
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * {@link IOAuthProvider} for Google.
 *
 * Google publishes its own discovery document at
 * `https://accounts.google.com/.well-known/openid-configuration`, but this
 * adapter does not fetch it: the three endpoints it names have been stable
 * for as long as Google has offered OpenID Connect, and constants here mean
 * one fewer network round trip and one fewer thing that can fail before this
 * deployment's own client id and secret ever come into play. `OidcOAuthProvider`
 * is the adapter that has to discover, because it is the one built for an
 * issuer nobody wrote constants for.
 *
 * Both endpoints below are consumed only by {@link exchangeForAccount}
 * (`oidc-exchange.ts`), which this class shares with `OidcOAuthProvider` —
 * see that module's own doc for the security properties the exchange holds
 * regardless of which provider it is talking to (the client secret travels
 * in the POST body, `email_verified` is read strictly, a response with no
 * subject is refused).
 */
export class GoogleOAuthProvider implements IOAuthProvider {
  public readonly provider = AuthProvider.GOOGLE;

  constructor(
    private readonly credentials: OAuthClientCredentials,
    private readonly http: typeof fetch = fetch,
  ) {}

  /** @returns the URL to send the browser to at Google's own authorization endpoint. */
  public authorizationUrl(params: AuthorizationUrlParams): string {
    return buildAuthorizationUrl(AUTHORIZATION_ENDPOINT, this.credentials.clientId, params);
  }

  /** @returns what Google's userinfo endpoint says about the account behind `params.code`. */
  public fetchAccount(params: ExchangeParams): Promise<FederatedAccount> {
    return exchangeForAccount(
      AuthProvider.GOOGLE,
      { tokenEndpoint: TOKEN_ENDPOINT, userinfoEndpoint: USERINFO_ENDPOINT },
      this.credentials,
      params,
      this.http,
    );
  }
}
