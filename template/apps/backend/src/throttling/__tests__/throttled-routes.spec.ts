import { AuthController } from '../../auth/auth.controller';
import { MfaController } from '../../mfa/mfa.controller';
import { ForgeThrottlerGuard } from '../forge-throttler.guard';
import { THROTTLE_BUCKET } from '../throttled.decorator';
import { ThrottleSubject } from '../throttling.config';

/**
 * # Every route that spends a budget, and which one
 *
 * The thing this file pins is wiring, and wiring fails silently: a route that
 * never received its `@Throttled` is not refused, not logged and not noticed.
 * It answers every request, forever, and no other assertion in this suite
 * would be different. So each row below fails when its own decorator is
 * deleted, and each was watched doing so with the others still green.
 *
 * | Fault | Caught by |
 * |---|---|
 * | a route's `@Throttled` is deleted, or names another bucket | that route's row in `draws on its bucket` |
 * | a route that must be metered is absent from the table | nothing here — the table is the list, and a route added without a row is the one gap this file cannot see |
 * | a token that names no challenge stops being a subject | `meters an attempt whose challenge does not exist` |
 *
 * The middle row is stated rather than hidden: the table cannot know about a
 * route nobody added to it.
 *
 * ## Why a table, and not a case per route
 *
 * The assertion is identical for every row and the risk is a row being absent,
 * which a reader can see in one place and cannot see spread over many blocks.
 *
 * ## What is deliberately not here
 *
 * `POST /auth/login` draws on `credential`, keyed on the submitted address, and
 * not on `mfa-mint`. Minting a challenge on the password path is therefore
 * bounded by the login budget per address — which is what stops somebody who
 * holds a password from buying a fresh per-challenge allowance by signing in
 * again. `mfa-mint` sits only on routes that already carry a challenge or a
 * session.
 */
const EXPECTED: ReadonlyArray<readonly [string, string, string, unknown]> = [
  ['AuthController', 'login', 'credential', AuthController],
  ['AuthController', 'forgotPassword', 'credential', AuthController],
  ['AuthController', 'resendVerification', 'credential', AuthController],
  ['AuthController', 'resetPassword', 'reset-credential', AuthController],
  ['AuthController', 'verifyMfa', 'mfa-attempt', AuthController],
  ['AuthController', 'mfaMethods', 'mfa-mint', AuthController],
  ['MfaController', 'enrollTotp', 'mfa-mint', MfaController],
  ['MfaController', 'confirmTotp', 'mfa-proof', MfaController],
  ['MfaController', 'regenerateRecoveryCodes', 'mfa-proof', MfaController],
  ['MfaController', 'remove', 'mfa-proof', MfaController],
  ['MfaController', 'webAuthnOptions', 'mfa-mint', MfaController],
  ['MfaController', 'webAuthnVerify', 'mfa-attempt', MfaController],
];

/** A value that names no challenge. Named, not inlined, so no line reads as a populated secret. */
const UNKNOWN_CHALLENGE = 'no-such-challenge';

describe('every route that spends a budget declares which one', () => {
  it.each(EXPECTED)('%s.%s draws on %s', (_name, method, bucket, controller) => {
    const handler = (controller as { prototype: Record<string, unknown> }).prototype[method];

    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(THROTTLE_BUCKET, handler as object)).toBe(bucket);
  });

  it('meters an attempt whose challenge does not exist', () => {
    // The subject is the token as presented, not a challenge resolved from it,
    // so a token naming nothing is still a subject and still spends budget.
    // Were it resolved first, the cheapest attack would be to send garbage, and
    // the budget would only ever meter honest callers.
    const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.CHALLENGE, {
      body: { challengeToken: UNKNOWN_CHALLENGE },
    });

    expect(tracker).toBe(`challenge:${UNKNOWN_CHALLENGE}`);
    expect(tracker).not.toBe(ForgeThrottlerGuard.MALFORMED);
  });
});
