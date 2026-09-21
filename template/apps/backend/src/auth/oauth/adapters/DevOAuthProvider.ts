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
 * **It auto-approves — no human step of any kind, and no page.** This is what
 * makes it a *development* adapter rather than merely a convenient one:
 * `authorizationUrl` mints a code for the one address this deployment
 * configured (`OAUTH_DEV_EMAIL`) and returns `redirectUri` — this
 * application's own callback, the same URL `OidcOAuthProvider`,
 * `GoogleOAuthProvider` and `GitHubOAuthProvider` are redirected back to —
 * with that code and the caller's `state` already attached. Pressing
 * "sign in" redirects straight back into the real callback, which does
 * everything a real provider's callback does: the row lookup under a write
 * lock, single-use consumption, the exchange, `decideFederatedSignIn` or
 * `decideFederatedLink`, session issuance. **There has never been a page, and
 * Task 12 ruled out building one**: the first cut of this adapter left
 * `authorizationUrl` pointing at an unbuilt `GET /auth/oauth/dev/authorize`
 * that 404'd — exactly the "button that fails when someone presses it"
 * ADR-0008 forbids, and it also made an end-to-end walk through this adapter
 * impossible. Routing straight back into the real callback closes both at
 * once, with no HTML ever served from this REST API and no open-redirect
 * trust decision to make about a caller-supplied destination — see
 * {@link DevOAuthProvider.authorizationUrl}'s own doc for exactly what it
 * returns and why nothing here reads a redirect target from anywhere but
 * `params.redirectUri`, which this application itself constructed.
 *
 * `fetchAccount` hands back `emailVerified: true` for `OAUTH_DEV_EMAIL` with
 * no credential presented and no party other than this process ever asked to
 * confirm anything. That is a total authentication bypass, on purpose, so a
 * freshly generated project can exercise the whole sign-in flow — and,
 * config permitting, the link-conflict flow Task 19's own walk needs — before
 * anyone has registered a real provider anywhere.
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
 * A minted code replaying indefinitely was a real weakness even while nothing
 * called `mintAuthorizationCode` (Task 6's own carried note); now something
 * does, on every single sign-in through this adapter, so `exp` and `consumed`
 * are load-bearing rather than merely prudent.
 *
 * `codeVerifier` is accepted, to satisfy `IOAuthProvider`'s shape, and
 * deliberately not checked. PKCE exists to stop an authorization code stolen
 * in transit between a real provider and an untrusted client from being
 * redeemed by anyone but the party that started the request; here the code is
 * minted and redeemed inside this one process, by this one adapter, for a
 * flow with no such provider on the other end. Checking a value against
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
   * @param address - the one address this adapter ever asserts, from this
   *   deployment's own configuration (`OAUTH_DEV_EMAIL`, required whenever
   *   `OAUTH_DEV_ENABLED` is — see `buildOAuthProviders`). Never taken from a
   *   request, a query parameter, or anything a caller supplies: there is no
   *   page and no per-request input of any kind, which is exactly what makes
   *   this a "no human step" bypass rather than a form with a text field.
   */
  public constructor(private readonly address: string) {}

  /**
   * Mints a code for {@link DevOAuthProvider.address} and hands back
   * `redirectUri` — this application's own callback — carrying that code and
   * the caller's `state`. **No page, no separate address-collection step:**
   * a browser sent to this URL lands directly back at
   * `GET /auth/oauth/:provider/callback`, which does the whole of the real
   * flow from there. `params.codeChallenge` and `params.codeVerifier` are
   * accepted, to satisfy `IOAuthProvider`'s shape, and never read — see the
   * class's own doc for why PKCE has nothing to check here.
   *
   * `async` for no reason of this method's own — it does no I/O — but
   * `IOAuthProvider.authorizationUrl` returns `Promise<string>` for every
   * adapter, because `OidcOAuthProvider` needs to and a port is one shape for
   * every implementation behind it. See that interface's own doc for why.
   */
  public async authorizationUrl(params: AuthorizationUrlParams): Promise<string> {
    const code = this.mintAuthorizationCode(this.address);
    const query = new URLSearchParams({ code, state: params.state });
    return `${params.redirectUri}?${query.toString()}`;
  }

  /**
   * Mints a code asserting `address`. Not part of {@link IOAuthProvider} —
   * `authorizationUrl` is this class's only caller in production, always
   * with {@link DevOAuthProvider.address}; kept `public` and parameterised
   * (rather than reading `this.address` directly) because this suite mints
   * codes for arbitrary test addresses to exercise `fetchAccount` in
   * isolation.
   *
   * The payload carries `exp` alongside `address`, signed together — Task
   * 12's seam-closing: a code minted here is good for
   * {@link DEV_OAUTH_CODE_TTL_MS} and no longer, checked in
   * {@link DevOAuthProvider.fetchAccount} the same way a real provider's own
   * authorization code would expire.
   *
   * `nonce` exists so that two codes minted for the same address within the
   * same millisecond are never byte-identical — found by this class's own
   * test for "mints a fresh code on every call" failing, the first time it
   * was written, because `{ address, exp }` alone collides whenever `Date.now()`
   * has not ticked between two calls. Two colliding codes would share one
   * signature in {@link DevOAuthProvider.consumed}, so redeeming the first of
   * two pending authorizations would silently spend the second's code too —
   * a real, if narrow, correctness gap this field closes outright rather than
   * leaving to timing.
   */
  public mintAuthorizationCode(address: string): string {
    const encoded = DevOAuthProvider.encode({
      address,
      exp: Date.now() + DEV_OAUTH_CODE_TTL_MS,
      nonce: randomBytes(9).toString('base64url'),
    });
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
   * wrote — including every earlier shape this file has had (a bare address
   * with no `exp` at all before Task 12; `{ address, exp }` with no `nonce`
   * in Task 12's first pass): this process never persists a code past its
   * own lifetime, so there is no old shape in the wild to stay compatible
   * with, and the safe default for anything unrecognised is to refuse it
   * rather than guess.
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
      || typeof (parsed as { nonce?: unknown }).nonce !== 'string'
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
  /** Never read back out — present only so two codes are never byte-identical. */
  readonly nonce: string;
}
