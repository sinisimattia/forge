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
 * ## Discovery happens on first use, not at start-up
 *
 * `IOAuthProvider.authorizationUrl` returns `Promise<string>` precisely so
 * this adapter can await discovery inline rather than needing it to have
 * completed already — see that interface's own doc. Both `authorizationUrl`
 * and `fetchAccount` call {@link OidcOAuthProvider.ensureEndpoints}, which
 * fetches the discovery document on the first call from either method and
 * caches the *in-flight* promise (not merely the resolved value), so two
 * concurrent first calls — one to each method, or two callers racing — share
 * one fetch rather than issuing two.
 *
 * Discovery is deliberately lazy rather than performed eagerly at start-up:
 * an issuer that is merely unreachable for a moment would otherwise fail this
 * whole application's boot, which is a far larger outage than one federated
 * provider being unavailable for the one person who tries it during that
 * window. A failed discovery is not cached — the next call retries — so a
 * transient outage costs one failed sign-in attempt, not every attempt for
 * the rest of the process's life.
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
   *   authorization endpoint. Awaits discovery inline on the first call (see
   *   this class's own doc); every call after the first, whether discovery
   *   already succeeded or is still in flight, resolves without a second fetch.
   */
  public async authorizationUrl(params: AuthorizationUrlParams): Promise<string> {
    const endpoints = await this.ensureEndpoints();
    return buildAuthorizationUrl(
      endpoints.authorizationEndpoint, this.credentials.clientId, params,
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
   * The single path both public methods discover endpoints through. Caches
   * the **in-flight promise**, not the resolved value, in `this.discovery` —
   * assigned synchronously, before this method's first `await` runs — so a
   * second call arriving before the first has resolved (whether from the
   * other public method or a second caller of this one) sees that promise
   * already set and awaits the same fetch rather than starting another one.
   * `OidcOAuthProvider.spec.ts`'s "fetches the discovery document only once
   * under concurrent first calls" is what turns red if that guarantee breaks.
   */
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
