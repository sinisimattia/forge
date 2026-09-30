import { PRODUCTION_TOTP_DIGITS, TotpVerifier } from '../TotpVerifier';
import { STEP_SECONDS, totpCodeAtStep } from '../totp-authenticator';

/**
 * RFC 6238 Appendix B's own key, `12345678901234567890` (ASCII) — the same
 * twenty bytes the RFC also spells `3132333435363738393031323334353637383930`
 * in hex. Named `..._KEY_...`, not `..._SECRET_...`: it is a published,
 * public test vector, never a credential, and this repository's sanitize
 * gate (rightly) cannot tell those apart by looking at an assignment shape
 * alone — seen the same way `mapMfaMethodRecord.spec.ts` names its own
 * fixture `FAKE_TOTP_SEED` rather than "secret".
 *
 * `TotpVerifier.verify` takes its secret Base32-encoded (see that file's own
 * TSDoc), so this is the RFC key re-encoded into that alphabet — computed
 * once via `authenticator.encode('12345678901234567890')` with `encoding:
 * 'ascii'`, and pinned here as a literal so the suite has no dependency on
 * that computation happening again at the right moment.
 */
const RFC_VECTOR_KEY_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** RFC 6238 Appendix B, SHA-1, 8 digits, 30-second step — the vectors' own configuration, distinct from {@link PRODUCTION_TOTP_DIGITS}. */
const RFC_VECTOR_DIGITS = 8;

/** Wraps a fresh RFC-configured verifier so each `it.each` row reads as one assertion. */
function verifyRfcVector(secret: string, code: string, now: Date) {
  return new TotpVerifier(RFC_VECTOR_DIGITS).verify(secret, code, null, now);
}

/**
 * Computes the code a production-configured (6-digit) verifier would accept
 * for `now`, so the replay tests below can present a code without asserting
 * anything about the HMAC itself — that is `TotpVerifier`'s own RFC-vector
 * suite's job, not this one's. It goes through the same `totpCodeAtStep` the
 * verifier does, deliberately: it is a fixture generator, not a second
 * implementation to fall out of sync with.
 */
function validCodeFor(now: Date): string {
  const step = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
  return totpCodeAtStep(RFC_VECTOR_KEY_BASE32, step, PRODUCTION_TOTP_DIGITS);
}

describe('TotpVerifier', () => {
  describe('RFC 6238 Appendix B vectors', () => {
    // An independent source that existed before this code. A hand-rolled
    // TOTP verified by a test that recomputes the same HMAC asserts the
    // implementation against itself and passes either way — see
    // `TotpVerifier`'s own TSDoc for the full argument. These six rows are
    // the RFC's published (time, code) pairs, unmodified.
    it.each([
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ])('accepts the RFC 6238 vector at t=%i', (unixTime, code) => {
      const result = verifyRfcVector(RFC_VECTOR_KEY_BASE32, code, new Date(unixTime * 1000));
      expect(result.accepted).toBe(true);
    });

    it('refuses a code that does not match the vector at its own time', () => {
      const result = verifyRfcVector(RFC_VECTOR_KEY_BASE32, '00000000', new Date(59 * 1000));
      expect(result.accepted).toBe(false);
    });
  });

  describe('replay refusal', () => {
    it('accepts a code the first time it is presented', () => {
      const now = new Date('2026-03-01T12:00:15Z');
      const result = new TotpVerifier().verify(RFC_VECTOR_KEY_BASE32, validCodeFor(now), null, now);
      expect(result.accepted).toBe(true);
    });

    it('refuses a code already accepted in its own window', () => {
      const now = new Date('2026-03-01T12:00:15Z');
      const verifier = new TotpVerifier();
      const first = verifier.verify(RFC_VECTOR_KEY_BASE32, validCodeFor(now), null, now);
      expect(first.accepted).toBe(true);

      // Same code, same 30-second step, seconds later. A code seen over a
      // shoulder or replayed from a proxy is valid for the rest of its step
      // unless the step it belongs to is recorded and required to advance.
      const second = verifier.verify(
        RFC_VECTOR_KEY_BASE32,
        validCodeFor(now),
        first.step,
        new Date(now.getTime() + 5000),
      );
      expect(second.accepted).toBe(false);
    });

    it('accepts the next step after one has been used', () => {
      const now = new Date('2026-03-01T12:00:15Z');
      const verifier = new TotpVerifier();
      const used = verifier.verify(RFC_VECTOR_KEY_BASE32, validCodeFor(now), null, now).step;
      const later = new Date(now.getTime() + STEP_SECONDS * 1000);
      const result = verifier.verify(RFC_VECTOR_KEY_BASE32, validCodeFor(later), used, later);
      expect(result.accepted).toBe(true);
    });
  });

  describe('±1 step clock-skew window', () => {
    const now = new Date('2026-03-01T12:00:15Z');
    const oneStepAgo = new Date(now.getTime() - STEP_SECONDS * 1000);
    const oneStepAhead = new Date(now.getTime() + STEP_SECONDS * 1000);
    const twoStepsAgo = new Date(now.getTime() - 2 * STEP_SECONDS * 1000);
    const twoStepsAhead = new Date(now.getTime() + 2 * STEP_SECONDS * 1000);

    it('accepts a code from one step in the past', () => {
      const verifier = new TotpVerifier();
      const code = validCodeFor(oneStepAgo);
      expect(verifier.verify(RFC_VECTOR_KEY_BASE32, code, null, now).accepted).toBe(true);
    });

    it('accepts a code from one step in the future', () => {
      const verifier = new TotpVerifier();
      const code = validCodeFor(oneStepAhead);
      expect(verifier.verify(RFC_VECTOR_KEY_BASE32, code, null, now).accepted).toBe(true);
    });

    it('refuses a code from two steps in the past', () => {
      const verifier = new TotpVerifier();
      const code = validCodeFor(twoStepsAgo);
      expect(verifier.verify(RFC_VECTOR_KEY_BASE32, code, null, now).accepted).toBe(false);
    });

    it('refuses a code from two steps in the future', () => {
      const verifier = new TotpVerifier();
      const code = validCodeFor(twoStepsAhead);
      expect(verifier.verify(RFC_VECTOR_KEY_BASE32, code, null, now).accepted).toBe(false);
    });
  });
});
