import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { AuthorizationUrlParams, ExchangeParams, IOAuthProvider } from '../IOAuthProvider';

/** Separates the encoded address from its signature in a minted code. Never appears in base64url. */
const CODE_DELIMITER = '.';

/**
 * How long a minted code stays redeemable, in milliseconds.
 *
 * Task 12 closed the seam Task 6 left open: `mintAuthorizationCode` was public,
 * unguarded, and had no expiry or single-use enforcement — safe only because
 * nothing called it yet. The same ten minutes {@link OAUTH_AUTHORIZATION_TTL_MS}
 * gives the authorization row this code is presented against: a code that
 * outlived the row it is redeemed through would never matter, since
 * `OAuthService.complete` refuses an expired or already-consumed row first —
 * but a code minted for one round trip and still valid days later is exactly
 * the kind of latent capability this class's own doc calls "a bypass with a
 * green light on," and closing it here rather than leaning entirely on the
 * row is the same "more than one lock on the door" discipline this backend
 * already applies to PKCE alongside the state check.
 */
export const DEV_OAUTH_CODE_TTL_MS = 10 * 60 * 1000;

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
 * came from this instance, names the address it was minted for, and says when
 * it stops being good for anything. It is
 * `base64url(JSON.stringify({ address, exp })) + '.' + HMAC-SHA256(...)`,
 * keyed on a secret this instance generates once, at construction, and never
 * persists. `fetchAccount` recomputes the signature and compares it in
 * constant time; anything that does not match — wrong signature, wrong shape,
 * a code minted by a different instance (and therefore a different secret),
 * one past `exp`, or one already redeemed by this instance (`consumed`,
 * below) — is refused, with the same shape of error for every case (see that
 * method's own doc for why the refusals are deliberately indistinguishable).
 *
 * `authorizationUrl` cannot mint a code itself: it is called before this
 * adapter knows any address, with only a state value, a PKCE challenge and a
 * redirect URI to work with. It returns a URL, on this deployment's own
 * origin, for a page that collects an address and mints the code once one is
 * given — the page and the route that serves it are still not this class's
 * job and are still not wired: Task 12 closed the `mintAuthorizationCode`
 * seam itself (expiry, single-use) rather than building that page ahead of a
 * design for it, and flagged the gap for the coordinator instead. This class
 * only has to be ready to mint and to verify.
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
   * Signatures of codes already redeemed, for the life of this process.
   *
   * `fetchAccount` adds to this set the moment a code passes every other
   * check, and refuses on it before doing anything else — a code presented a
   * second time is refused with the same generic error a code this instance
   * never minted would get (see {@link DevOAuthProvider.fetchAccount}'s own
   * doc), so replaying a captured code discloses nothing about whether it
   * ever worked. Keyed on the signature rather than the whole code: the
   * signature is exactly the part that is unique per mint (the payload
   * includes `exp`, so even the same address minted twice differs), and it is
   * already computed on the hot path.
   */
  private readonly consumed = new Set<string>();

  /**
   * @param publicApiUrl - this deployment's own origin (`PUBLIC_API_URL`),
   *   the same value `buildOAuthProviders` already requires before building
   *   any provider. Never derived from a request.
   */
  public constructor(private readonly publicApiUrl: string) {}

  /**
   * @returns the address-collection page's URL, carrying everything it needs
   *   to complete the round trip. `async` for no reason of this method's
   *   own — it does no I/O — but `IOAuthProvider.authorizationUrl` returns
   *   `Promise<string>` for every adapter, because `OidcOAuthProvider` needs
   *   to and a port is one shape for every implementation behind it. See
   *   that interface's own doc for why.
   */
  public async authorizationUrl(params: AuthorizationUrlParams): Promise<string> {
    const query = new URLSearchParams({
      state: params.state,
      code_challenge: params.codeChallenge,
      // RFC 7636: an authorization request carrying `code_challenge` with no
      // `code_challenge_method` defaults to `plain` — a challenge equal to its
      // own verifier, the one method this phase forbids offering (see the
      // three real adapters, which all assert `'S256'`). This adapter ignores
      // PKCE entirely (see the class's own doc), so the omission was
      // functionally inert; it is fixed anyway because this URL is what a
      // generated project uses to rehearse the real flow, and it must not
      // model the forbidden method.
      code_challenge_method: 'S256',
      redirect_uri: params.redirectUri,
    });
    return `${this.publicApiUrl}/auth/oauth/dev/authorize?${query.toString()}`;
  }

  /**
   * Mints a code asserting `address`, for the not-yet-wired page described
   * above to hand back to the callback. Not part of {@link IOAuthProvider} —
   * nothing upstream of a real address exists to call it yet (see this
   * class's own doc: the page that collects an address and calls this method
   * still has no route, and remains outside this task's scope — flagged for
   * the coordinator rather than built ahead of a design for it).
   *
   * The payload carries `exp` alongside `address`, signed together — Task
   * 12's seam-closing: a code minted here is good for
   * {@link DEV_OAUTH_CODE_TTL_MS} and no longer, checked in
   * {@link DevOAuthProvider.fetchAccount} the same way a real provider's own
   * authorization code would expire.
   */
  public mintAuthorizationCode(address: string): string {
    const encoded = DevOAuthProvider.encode({ address, exp: Date.now() + DEV_OAUTH_CODE_TTL_MS });
    return `${encoded}${CODE_DELIMITER}${this.sign(encoded)}`;
  }

  /**
   * @returns the address the code was minted for, asserted verified — this
   *   adapter trusts no one else's word for it, because it asked no one else.
   * @throws Error for every refusal below, and deliberately the same generic
   *   message shape for each — a malformed code, one minted by a different
   *   instance, an expired one and a replayed one are indistinguishable to
   *   whoever presents them, matching the discipline
   *   `OAuthService.consumeAuthorizationRow` already holds the authorization
   *   row itself to (`AUTHORIZATION_UNKNOWN` covers "no row", "already
   *   consumed" and "wrong provider" alike). This method's caller —
   *   `OAuthService.complete`, by way of `provider.fetchAccount` — already
   *   turns any throw here into the single opaque `PROVIDER_UNAVAILABLE`
   *   redirect code regardless, but the distinction is refused here too, on
   *   principle, rather than leaning entirely on that caller to collapse it.
   */
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

    // Single-use, checked before the payload is even trusted to decode: a
    // signature this instance has already redeemed is refused exactly as one
    // it never minted would be.
    if (this.consumed.has(signature)) {
      throw new Error('DevOAuthProvider: this code has already been used.');
    }

    const decoded = DevOAuthProvider.decode(encoded);
    if (decoded === null) {
      throw new Error('DevOAuthProvider: malformed code.');
    }
    if (decoded.exp <= Date.now()) {
      throw new Error('DevOAuthProvider: this code has expired.');
    }

    // Marked consumed only once every other check has passed — a code that
    // never verified, or already expired, was never "used" and must not
    // poison the set for a differently-shaped presentation of the same
    // signature (there is none — the signature is a function of the whole
    // payload — but the ordering is the same discipline
    // `OAuthService.consumeAuthorizationRow` applies to its own row: mark
    // spent only for a presentation that was actually going to succeed).
    this.consumed.add(signature);

    return {
      provider: AuthProvider.OIDC,
      subject: decoded.address,
      email: decoded.address,
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

  /** The whole of turning a payload into the encoded half of a code. */
  private static encode(payload: DevOAuthCodePayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  /**
   * The inverse of {@link DevOAuthProvider.encode}, answering `null` for
   * anything that does not decode to exactly the shape this class ever
   * wrote — including the pre-Task-12 shape, a bare address with no `exp` at
   * all: this process never persists a code past its own lifetime, so there
   * is no old shape in the wild to stay compatible with, and the safe
   * default for anything unrecognised is to refuse it rather than guess.
   */
  private static decode(encoded: string): DevOAuthCodePayload | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (
      typeof parsed !== 'object' || parsed === null
      || typeof (parsed as { address?: unknown }).address !== 'string'
      || typeof (parsed as { exp?: unknown }).exp !== 'number'
    ) {
      return null;
    }
    return parsed as DevOAuthCodePayload;
  }
}

/** What a minted code's signed payload carries. */
interface DevOAuthCodePayload {
  readonly address: string;
  readonly exp: number;
}
