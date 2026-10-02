import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { AuthorizationUrlParams, ExchangeParams, IOAuthProvider } from '../IOAuthProvider';
import type { OAuthClientCredentials } from './oidc-exchange';

/** GitHub's own OAuth and REST endpoints — published, stable, and never discovered. */
const AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize';
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const USER_ENDPOINT = 'https://api.github.com/user';
const EMAILS_ENDPOINT = 'https://api.github.com/user/emails';

/**
 * Sent on every `api.github.com` call. GitHub's REST API answers a request
 * carrying no `User-Agent` with a `403`, unrelated to anything about the
 * request otherwise being well-formed — the value itself is never validated
 * against anything registered, so any non-empty string satisfies it. This one
 * names what is making the request, for whoever reads GitHub's own access
 * logs on the other end.
 */
const USER_AGENT = 'oauth-github-adapter';

/** What GitHub's `GET /user` discloses about the account — only the fields this adapter reads. */
interface GitHubUser {
  readonly id: unknown;
  readonly name: unknown;
}

/** One entry of what GitHub's `GET /user/emails` discloses — a list, one entry per address on the account. */
interface GitHubEmail {
  readonly email: unknown;
  readonly primary: unknown;
  readonly verified: unknown;
}

/** What this adapter needs from a `GET /user/emails` response, decided once and returned together. */
interface PrimaryEmail {
  readonly email: string | null;
  readonly emailVerified: boolean;
}

/**
 * {@link IOAuthProvider} for GitHub.
 *
 * **Not an OIDC provider — GitHub publishes no discovery document, no
 * userinfo endpoint and no `email_verified` claim on anything.** This adapter
 * therefore does not share `oidc-exchange.ts` with `GoogleOAuthProvider` and
 * `OidcOAuthProvider`; the one piece of that module's shape that genuinely
 * transfers — redeem an authorization code for an access token at a token
 * endpoint, with the client secret in the POST body — is reimplemented here
 * against GitHub's own token endpoint, which answers a shape neither of those
 * two adapters' shared exchange was written to parse (see below).
 *
 * The account itself comes from two separate calls, both authenticated with
 * the access token this exchange obtained: `GET /user` for the account's
 * identity, and `GET /user/emails` for the address GitHub says it verified —
 * see {@link fetchPrimaryEmail} for what "verified" means here and why no
 * fallback exists between the two.
 *
 * ## Two mechanics that are easy to get backwards, each one a network trip
 * away from where the resulting failure actually shows up
 *
 * **The token endpoint answers `application/x-www-form-urlencoded`, not
 * JSON, unless the request sends `accept: application/json`.** Omitting that
 * header does not fail the request — it changes the shape of a `200`
 * response, so `.json()` on the body throws a parse error with nothing in it
 * pointing back at a missing header.
 *
 * **`api.github.com` refuses a request that carries no `User-Agent`,
 * unconditionally, with a `403`.** A valid bearer token and a well-formed
 * request both fail identically to a malformed one if this header is absent.
 *
 * ## The numeric id, never the login
 *
 * `GET /user` also returns `login` — the handle a person signs commits and
 * URLs with. It is not read here for anything that identifies the account:
 * GitHub lets its owner rename it, and a released login can be claimed by
 * somebody else afterward. An identity keyed on `login` is an identity that
 * transfers with the name to whoever claims it next — exactly the
 * account-takeover path D11 exists to close, arriving through a different
 * door. `id` is immutable for the life of the account, and is what
 * {@link FederatedAccount.subject} is built from.
 */
export class GitHubOAuthProvider implements IOAuthProvider {
  public readonly provider = AuthProvider.GITHUB;

  constructor(
    private readonly credentials: OAuthClientCredentials,
    private readonly http: typeof fetch = fetch,
  ) {}

  /**
   * @returns the URL to send the browser to at GitHub's own authorization
   *   endpoint. `async` for no reason of this method's own — building it is
   *   pure string work, no I/O — but `IOAuthProvider.authorizationUrl` returns
   *   `Promise<string>` for every adapter. See that interface's own doc for why.
   */
  public async authorizationUrl(params: AuthorizationUrlParams): Promise<string> {
    const query = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: params.redirectUri,
      state: params.state,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      // The narrowest scope that discloses both an account and an address:
      // `read:user` for the account `GET /user` reads, `user:email` for
      // `GET /user/emails`. Neither is granted by GitHub's default
      // unscoped/public-only access.
      scope: 'read:user user:email',
    });
    return `${AUTHORIZATION_ENDPOINT}?${query.toString()}`;
  }

  /** @returns what GitHub says about the account behind `params.code` — its numeric id and, if verified, its primary address. */
  public async fetchAccount(params: ExchangeParams): Promise<FederatedAccount> {
    const accessToken = await this.exchangeCodeForAccessToken(params);
    const user = await this.fetchUser(accessToken);
    const { email, emailVerified } = await this.fetchPrimaryEmail(accessToken);

    return {
      provider: AuthProvider.GITHUB,
      subject: user.id,
      email,
      emailVerified,
      displayName: user.name,
    };
  }

  /**
   * Redeems the authorization code at GitHub's token endpoint.
   *
   * **The client secret travels in the POST body, never the URL** — a secret
   * in a query string is a secret in every proxy log between here and
   * GitHub. **`accept: application/json` is what makes the response
   * parseable at all** — see this class's own doc for what happens without it.
   */
  private async exchangeCodeForAccessToken(params: ExchangeParams): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    });

    const response = await this.http(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`${AuthProvider.GITHUB}: token endpoint answered ${response.status}.`);
    }

    const token = await response.json() as Record<string, unknown>;
    const accessToken = token.access_token;
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error(`${AuthProvider.GITHUB}: token endpoint response carried no access token.`);
    }
    return accessToken;
  }

  /**
   * @returns the account's numeric id (as {@link FederatedAccount.subject},
   *   stringified — the port declares `subject` as a `string` for every
   *   provider, GitHub's own being the one that is natively numeric) and its
   *   display name, read from `GET /user`.
   *
   * **A response with no `id` identifies nobody and throws** — the same rule
   * `exchangeForAccount` (`oidc-exchange.ts`) holds for a userinfo response
   * with no `sub`: an identity keyed on an empty or missing value is an
   * identity every such response would match.
   */
  private async fetchUser(accessToken: string): Promise<{ id: string; name: string | null }> {
    const response = await this.http(USER_ENDPOINT, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'user-agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`${AuthProvider.GITHUB}: user endpoint answered ${response.status}.`);
    }

    const user = await response.json() as GitHubUser;
    const { id } = user;
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      throw new Error(`${AuthProvider.GITHUB}: user endpoint response carried no id.`);
    }

    return {
      // Deliberately `id`, never `login` — see this class's own doc.
      id: String(id),
      name: typeof user.name === 'string' ? user.name : null,
    };
  }

  /**
   * @returns the account's verified primary address, or `{ email: null,
   *   emailVerified: false }` when none qualifies — including when the token
   *   cannot see addresses at all, which is a legitimate answer, not a
   *   fault: this must not throw and must not guess at an address to report
   *   instead.
   *
   * **Only the entry with `primary: true` is ever considered, and only when
   * that same entry also carries `verified: true`.** A primary address GitHub
   * marks unverified is reported as no verified address — **never
   * substituted with a different, verified entry from the same list.** The
   * primary address is the one the account holder publishes; silently
   * reporting a different one changes which account a later sign-in or link
   * attempt would match, invisibly to everyone involved. This is the single
   * most important piece of logic in this adapter.
   *
   * **`403` and `404` from this endpoint mean "this token cannot see
   * addresses", not "this request failed", and resolve to no address rather
   * than throwing.** This is not the shape a first read of `authorizationUrl`
   * suggests: that method already asks for `user:email`, so in the ordinary
   * case a token this adapter minted always carries it. But `authorizationUrl`
   * only controls what *this deployment* requested — it does not control what
   * GitHub, or an organisation's own OAuth-app policy, later leaves the token
   * able to see, and GitHub answers a token that cannot see addresses with a
   * `403` here (`404` is the same signal on some API versions), never a `200`
   * with an empty list. Throwing on that response would cost more than a
   * failed address lookup: `decideFederatedSignIn`'s first branch signs in an
   * already-linked subject unconditionally, before any address is examined,
   * specifically so a provider that stops disclosing an address cannot lock
   * somebody out of an account they already hold. A throw here reaches
   * `fetchAccount` before that branch ever runs, so every existing GitHub user
   * of a deployment whose token loses `user:email` scope — an organisation
   * policy change is enough — would stop being able to sign in at all, not
   * merely fail to link a new one. Reporting no address instead lets an
   * already-linked subject keep signing in exactly as it should, while a
   * brand-new subject reaches the correct, legible `REFUSE_UNVERIFIED_EMAIL`
   * outcome rather than an opaque failure.
   *
   * **Every other non-2xx still throws.** `401` means the access token itself
   * is invalid — not a scope question — and a `5xx` is a real endpoint
   * failure; treating either as "no address" would hide a fault this adapter
   * should surface.
   */
  private async fetchPrimaryEmail(accessToken: string): Promise<PrimaryEmail> {
    const response = await this.http(EMAILS_ENDPOINT, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'user-agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 404) {
        return { email: null, emailVerified: false };
      }
      throw new Error(`${AuthProvider.GITHUB}: emails endpoint answered ${response.status}.`);
    }

    const emails = await response.json() as GitHubEmail[];
    const primary = emails.find((entry) => entry.primary === true);
    if (!primary || typeof primary.email !== 'string' || primary.email.length === 0) {
      return { email: null, emailVerified: false };
    }

    return {
      email: primary.email,
      // Strict identity, not truthiness — same rule as `email_verified` in
      // `oidc-exchange.ts`: only the literal boolean `true` counts.
      emailVerified: primary.verified === true,
    };
  }
}
