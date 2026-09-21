import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { AuthorizationUrlParams, ExchangeParams, IOAuthProvider } from '../IOAuthProvider';

/** Separates the encoded address from its signature in a minted code. Never appears in base64url. */
const CODE_DELIMITER = '.';

/**
 * {@link IOAuthProvider} that authenticates nobody.
 *
 * ADR-0008's instance for this port: the template binds no developer
 * application at any federated provider, so this is what a generated project
 * ships until somebody writes a real adapter against `IOAuthProvider`.
 * Without it, federated sign-in cannot be exercised at all until somebody
 * registers an application at Google — the seam exists and is wired; the
 * account behind it does not. See `NoOpBreachedPasswordRegistry` for the same
 * argument made about a different port.
 *
 * **It is not a stub that can be left alone; it is a bypass with a green light
 * on.** `fetchAccount` hands back `emailVerified: true` for whatever address
 * was typed into this adapter's own page, with no credential presented and no
 * party other than this process ever asked to confirm anything. That is a
 * total authentication bypass, on purpose, so a freshly generated project can
 * exercise the whole sign-in flow before anyone has registered a real
 * provider anywhere.
 *
 * **This class does not itself refuse to run in production — that refusal is
 * not its job.** `buildOAuthProviders` in `../oauth.config.ts` owns both
 * guards that keep it out of a real deployment: it throws at start-up when
 * `OAUTH_DEV_ENABLED` is set alongside `NODE_ENV=production` ("Production
 * never runs the development provider"), and it throws again, in any
 * environment, when a real generic OIDC provider is configured alongside this
 * one, because both answer to the single `AuthProvider.OIDC` member and a
 * registry can hold only one of them without silently picking a winner by
 * construction order (that file's PF-1 guard, "The development provider and a
 * real generic OIDC provider never register together"). Repeating either
 * check here would be a second copy of a rule that only has to be right in
 * one place; `buildOAuthProviders` is that place, read it before trusting
 * that this class is contained.
 *
 * ## What it must never become
 *
 * **No network call, ever.** That is the property that makes this the
 * *development* adapter rather than a badly-written real one — it has to work
 * with nothing registered anywhere, including no DNS route to a provider that
 * does not exist for it. `fetchAccount` is asserted never to contain the
 * substring `fetch(` for exactly this reason: the assertion is on the method
 * body, not on behaviour observed through a mock, so it fails the day this
 * class grows a call it should not have rather than the day a test happens to
 * exercise it.
 *
 * ## How the code is bound to the address, without a network or a store
 *
 * A real provider's authorization code is redeemed by asking the provider —
 * this one has nobody to ask, so the code itself has to carry proof that it
 * came from this instance and names the address it was minted for. It is
 * `base64url(address) + '.' + HMAC-SHA256(address)`, keyed on a secret this
 * instance generates once, at construction, and never persists. `fetchAccount`
 * recomputes the signature and compares it in constant time; anything that
 * does not match — wrong signature, wrong shape, or a code minted by a
 * different instance (and therefore a different secret) — is refused.
 *
 * `authorizationUrl` cannot mint a code itself: it is called before this
 * adapter knows any address, with only a state value, a PKCE challenge and a
 * redirect URI to work with. It returns a URL, on this deployment's own
 * origin, for a page that collects an address and mints the code once one is
 * given — the page and the route that serves it are not this class's job and
 * are not wired yet (see `oauth.config.ts`'s note that no route reaches this
 * port until Task 12); this class only has to be ready to mint and to verify.
 *
 * `codeVerifier` and `redirectUri` are accepted, to satisfy `IOAuthProvider`'s
 * shape, and deliberately not checked. PKCE exists to stop an authorization
 * code stolen in transit between a real provider and an untrusted client from
 * being redeemed by anyone but the party that started the request; here the
 * code is minted and redeemed inside this one process, by this one adapter,
 * for a flow with no such provider on the other end. Checking a value against
 * nothing it was ever compared to at mint time would be a check in name only.
 */
export class DevOAuthProvider implements IOAuthProvider {
  public readonly provider = AuthProvider.OIDC;

  /**
   * Generated fresh per instance, never configured and never persisted. A
   * code minted by one instance is refused by another for exactly this reason
   * — there is nothing to share it with, and nothing here needs one.
   */
  private readonly secret = randomBytes(32);

  /**
   * @param publicApiUrl - this deployment's own origin (`PUBLIC_API_URL`),
   *   the same value `buildOAuthProviders` already requires before building
   *   any provider. Never derived from a request.
   */
  public constructor(private readonly publicApiUrl: string) {}

  /** @returns the address-collection page's URL, carrying everything it needs to complete the round trip. */
  public authorizationUrl(params: AuthorizationUrlParams): string {
    const query = new URLSearchParams({
      state: params.state,
      code_challenge: params.codeChallenge,
      redirect_uri: params.redirectUri,
    });
    return `${this.publicApiUrl}/auth/oauth/dev/authorize?${query.toString()}`;
  }

  /**
   * Mints a code asserting `address`, for the not-yet-wired page described
   * above to hand back to the callback. Not part of {@link IOAuthProvider} —
   * nothing upstream of a real address exists to call it yet.
   */
  public mintAuthorizationCode(address: string): string {
    const encoded = Buffer.from(address, 'utf8').toString('base64url');
    return `${encoded}${CODE_DELIMITER}${this.sign(encoded)}`;
  }

  /** @returns the address the code was minted for, asserted verified — this adapter trusts no one else's word for it, because it asked no one else. */
  public async fetchAccount(params: ExchangeParams): Promise<FederatedAccount> {
    const delimiterIndex = params.code.indexOf(CODE_DELIMITER);
    if (delimiterIndex < 0) {
      throw new Error('DevOAuthProvider: malformed code.');
    }

    const encoded = params.code.slice(0, delimiterIndex);
    const signature = params.code.slice(delimiterIndex + CODE_DELIMITER.length);
    if (!this.matchesSignature(encoded, signature)) {
      throw new Error('DevOAuthProvider: this code was not minted by this adapter.');
    }

    const address = Buffer.from(encoded, 'base64url').toString('utf8');

    return {
      provider: AuthProvider.OIDC,
      subject: address,
      email: address,
      emailVerified: true,
      displayName: null,
    };
  }

  private sign(encoded: string): string {
    return createHmac('sha256', this.secret).update(encoded).digest('base64url');
  }

  private matchesSignature(encoded: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(encoded));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
