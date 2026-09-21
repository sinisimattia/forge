import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { AuthorizationUrlParams, ExchangeParams, IOAuthProvider } from '../IOAuthProvider';
import { buildAuthorizationUrl, exchangeForAccount } from './oidc-exchange';
import type { OAuthClientCredentials } from './oidc-exchange';

/** The three endpoints a discovery document is required to name, once validated. */
interface OidcEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly userinfoEndpoint: string;
}

const DISCOVERY_PATH = '/.well-known/openid-configuration';

/**
 * {@link IOAuthProvider} for any OpenID Connect issuer that is neither Google
 * nor GitHub — the adapter `OAUTH_OIDC_ISSUER_URL` configures.
 *
 * Unlike `GoogleOAuthProvider`, this adapter has no endpoints to hardcode: it
 * fetches `${issuer}/.well-known/openid-configuration` once and caches the
 * three endpoints it names for the process's lifetime (an issuer does not
 * relocate its own token endpoint while this process is running, and
 * refetching on every sign-in would spend a round trip this deployment's own
 * configuration already answered once).
 *
 * ## The discovery document is data, not trust
 *
 * This adapter fetches the document from a configured issuer, but the
 * endpoints named *inside* it are still values a third party supplied, not
 * facts this deployment established. A discovery document that named a
 * `token_endpoint` on another origin — through compromise, misconfiguration,
 * or a issuer that simply proxies a value it never validated — would hand
 * this deployment's client secret to whoever controls that origin the moment
 * `fetchAccount` ran `exchangeForAccount` against it. **Every endpoint the
 * document names is asserted `https:` and on the issuer's own origin before
 * it is used for anything** ({@link OidcOAuthProvider.discover}); a document
 * that fails this check is refused before a single request carries a secret
 * anywhere it named.
 *
 * ## Why `authorizationUrl` can throw before a browser is ever sent anywhere
 *
 * `IOAuthProvider.authorizationUrl` is synchronous — it returns a `string`,
 * not a `Promise<string>` — because everything it returns is a URL the
 * *browser* carries, built with no network call of its own. Discovery,
 * however, is a network call, and this adapter has no endpoint to build that
 * URL from until it completes. The two are reconciled by {@link warmUp}: not
 * part of `IOAuthProvider` (same idiom as `DevOAuthProvider.mintAuthorizationCode`
 * — an adapter may carry more than its port requires), it performs discovery
 * ahead of the first request and is meant to be awaited once, at start-up,
 * before this adapter is reachable from any route. `authorizationUrl` throws,
 * with a message naming `warmUp`, rather than return a URL built from
 * nothing — a broken link discovered by whoever clicks it first is worse than
 * a start-up failure, the same reasoning `buildOAuthProviders` already
 * applies to a missing `PUBLIC_API_URL`. `fetchAccount` does not have this
 * problem: it is already `Promise`-returning, so it can simply await
 * discovery itself the first time it is called, `warmUp` or not.
 */
export class OidcOAuthProvider implements IOAuthProvider {
  public readonly provider = AuthProvider.OIDC;

  /** Resolved endpoints, once discovery has completed. `null` until then. */
  private endpoints: OidcEndpoints | null = null;

  /** The in-flight (or completed) discovery fetch, memoized so it runs at most once. */
  private discovery: Promise<OidcEndpoints> | null = null;

  constructor(
    private readonly issuer: string,
    private readonly credentials: OAuthClientCredentials,
    private readonly http: typeof fetch = fetch,
  ) {}

  /**
   * @returns the URL to send the browser to, built from the discovered
   *   authorization endpoint.
   * @throws if discovery has not completed — call {@link warmUp} once at
   *   start-up before this adapter serves a request.
   */
  public authorizationUrl(params: AuthorizationUrlParams): string {
    if (!this.endpoints) {
      throw new Error(
        'OidcOAuthProvider: discovery has not completed yet. Call warmUp() once at start-up, '
        + 'before this adapter is reachable from a route — authorizationUrl is synchronous by '
        + 'IOAuthProvider\'s own contract and cannot itself await the discovery document.',
      );
    }
    return buildAuthorizationUrl(
      this.endpoints.authorizationEndpoint, this.credentials.clientId, params,
    );
  }

  /** @returns what the issuer's userinfo endpoint says about the account behind `params.code`. */
  public async fetchAccount(params: ExchangeParams): Promise<FederatedAccount> {
    const endpoints = await this.ensureEndpoints();
    return exchangeForAccount(
      AuthProvider.OIDC,
      { tokenEndpoint: endpoints.tokenEndpoint, userinfoEndpoint: endpoints.userinfoEndpoint },
      this.credentials,
      params,
      this.http,
    );
  }

  /**
   * Performs discovery ahead of the first request, so {@link authorizationUrl}
   * has something to build from. Not part of `IOAuthProvider`. Idempotent and
   * safe to call more than once — every call after the first resolves the
   * same cached endpoints (or re-attempts discovery, if every prior attempt
   * failed).
   */
  public async warmUp(): Promise<void> {
    await this.ensureEndpoints();
  }

  private ensureEndpoints(): Promise<OidcEndpoints> {
    if (this.endpoints) {
      return Promise.resolve(this.endpoints);
    }
    if (!this.discovery) {
      this.discovery = this.discover()
        .then((endpoints) => {
          this.endpoints = endpoints;
          return endpoints;
        })
        .catch((error: unknown) => {
          // Do not cache a failure for the process's lifetime: a discovery
          // document that is momentarily unreachable should not permanently
          // wedge every later sign-in attempt behind the one request that
          // happened to run first.
          this.discovery = null;
          throw error;
        });
    }
    return this.discovery;
  }

  private async discover(): Promise<OidcEndpoints> {
    const response = await this.http(`${this.issuer}${DISCOVERY_PATH}`);
    if (!response.ok) {
      throw new Error(
        `OidcOAuthProvider: discovery document fetch answered ${response.status} for issuer `
        + `${this.issuer}.`,
      );
    }

    const document = await response.json() as Record<string, unknown>;
    const issuerOrigin = new URL(this.issuer).origin;

    return {
      authorizationEndpoint: this.assertSameOrigin(
        document.authorization_endpoint, issuerOrigin, 'authorization_endpoint',
      ),
      tokenEndpoint: this.assertSameOrigin(document.token_endpoint, issuerOrigin, 'token_endpoint'),
      userinfoEndpoint: this.assertSameOrigin(
        document.userinfo_endpoint, issuerOrigin, 'userinfo_endpoint',
      ),
    };
  }

  /**
   * The check that makes discovery safe to trust: the document came from a
   * configured issuer, but a value *inside* it is still data the issuer
   * supplied, not a fact this deployment established on its own. Requiring
   * `https:` and the issuer's own origin means a document — compromised,
   * misconfigured, or simply wrong — cannot redirect this deployment's client
   * secret to a token endpoint on some other origin; see this class's own
   * doc for what that endpoint would otherwise be handed.
   */
  private assertSameOrigin(value: unknown, issuerOrigin: string, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `OidcOAuthProvider: discovery document for issuer ${this.issuer} carried no ${field}.`,
      );
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        `OidcOAuthProvider: discovery document's ${field} ("${value}") is not a valid URL.`,
      );
    }

    if (url.protocol !== 'https:' || url.origin !== issuerOrigin) {
      throw new Error(
        `OidcOAuthProvider: discovery document's ${field} ("${value}") is not https and on the `
        + `issuer's own origin (${issuerOrigin}). Refusing before this deployment's client `
        + 'secret is ever sent to an endpoint the issuer did not attest to.',
      );
    }

    return value;
  }
}
