import { timingSafeEqual } from 'node:crypto';
import { STEP_SECONDS, totpCodeAtStep } from './totp-authenticator';

export { STEP_SECONDS };

/**
 * The code length this file ships for real accounts — six digits, what
 * every mainstream authenticator app (Google Authenticator, Authy,
 * 1Password, …) and this project's own enrollment screen assume. The only
 * other value ever constructed in this codebase is eight, and only from
 * `__tests__/TotpVerifier.spec.ts`'s RFC 6238 Appendix B suite — see
 * {@link TotpVerifier}'s own TSDoc for why that is a second, test-only
 * configuration rather than a reason to raise this one.
 */
export const PRODUCTION_TOTP_DIGITS = 6;

/**
 * How many steps either side of "now" a code is still checked against.
 * RFC 6238 §5.2 recommends allowing "at most one time step" of drift; this
 * file allows one step each way, so a client clock running fast or slow by
 * up to ~30 seconds still authenticates.
 */
const WINDOW_STEPS = 1;

/**
 * What {@link TotpVerifier.verify} answers.
 *
 * `step` is the RFC 6238 time-step counter the accepted code belonged to
 * (`floor(unixSeconds / 30)`), meaningful only when `accepted` is `true` —
 * a caller persists it to `mfa_methods.totp_last_step` so the *next*
 * presentation can be refused unless its own step is strictly greater. When
 * `accepted` is `false`, `step` is the step "now" fell in, carried for
 * logging only; nothing should be written from it.
 */
export interface TotpVerificationResult {
  readonly accepted: boolean;
  readonly step: number;
}

/**
 * Checks a TOTP code against a shared secret, refusing replay within a
 * step's own window.
 *
 * ## Why this is pinned to RFC 6238 Appendix B, not to its own arithmetic
 *
 * A hand-rolled TOTP verified by a test that recomputes the same HMAC the
 * implementation does is the tautology this codebase already has a rule
 * against: the driver's expectation and the implementation's answer are
 * drawn from one source, so the test passes whether the implementation is
 * right or wrong. RFC 6238 Appendix B's published vectors are an
 * independent source that existed before this file — SHA-1, the ASCII key
 * `12345678901234567890`, 8 digits, a 30-second step, and six Unix times
 * with the code each one must produce. `__tests__/TotpVerifier.spec.ts`
 * asserts every one of them; only *that* assertion is evidence this file's
 * HMAC and time-step arithmetic are correct, not merely self-consistent.
 *
 * ## `otplib`'s two variants, and why this file uses `authenticator`
 *
 * `otplib` ships a `totp` object, whose secret is taken in whatever raw
 * `encoding` its options name (ASCII by default), and an `authenticator`
 * object, which always takes its secret as a Base32 string and decodes it
 * before generating — the shape Google Authenticator and every other
 * mainstream app expect, and the same shape
 * `TotpEnrollmentOffer.secret` hands a person for manual entry. This file
 * uses `authenticator` for exactly that reason: the `secret` this method
 * takes is the Base32 string `mfa_methods.totp_secret` holds, the same one
 * enrollment showed. Neither variant's *defaults* are used unexamined —
 * `algorithm`, `digits`, `step` and `encoding` (the encoding
 * `authenticator` decodes its Base32 input *into*, before handing it to the
 * same time-step arithmetic `totp` uses) are set explicitly on every call,
 * because `authenticator`'s own default digit count is 6, not the 8 the
 * RFC's vectors are published in — see `PRODUCTION_TOTP_DIGITS`'s own
 * TSDoc for why production stays at 6 and the vectors get their own
 * instance instead.
 *
 * `authenticator` is a shared, mutable singleton, and every touch of it —
 * this file's included — goes through `totpCodeAtStep` in
 * `totp-authenticator.ts`, which sets every option and reads the result in one
 * synchronous call. Nothing here assigns `authenticator.options` itself.
 *
 * ## Replay refusal
 *
 * A code observed over a shoulder, or replayed from a proxy, stays a valid
 * answer for the rest of its 30-second step — TOTP proves knowledge of the
 * secret at a moment, not that the presenter is the one who computed the
 * code just now. Recording the step a code was accepted for, and refusing
 * a candidate step that is not **strictly greater** than it, closes that
 * window: the same code presented twice is accepted once. `>=` here would
 * still let the second presentation through, since the first candidate step
 * checked is one already spent — see `__tests__/TotpVerifier.spec.ts`'s
 * replay suite, which is written to fail if this ever regresses to `>=`.
 */
export class TotpVerifier {
  /**
   * @param digits - the code length this instance checks candidates
   *   against. Defaults to {@link PRODUCTION_TOTP_DIGITS}; the only other
   *   value constructed anywhere in this codebase is 8, built only by the
   *   RFC-vector suite in this file's own tests.
   */
  public constructor(private readonly digits: number = PRODUCTION_TOTP_DIGITS) {}

  /**
   * Checks `code` against every step in the ±1-step window around `now`,
   * skipping any step not strictly greater than `lastStep`, and returns the
   * first match.
   *
   * The window is walked oldest-to-newest (`now - 1`, `now`, `now + 1`) so
   * that when more than one step in range would otherwise match — never
   * true for a real code, since consecutive steps' HMACs are unrelated, but
   * true for whatever a test constructs — the accepted step is the
   * earliest one that satisfies `lastStep`, not an arbitrary one.
   *
   * @param secret - the shared secret, Base32-encoded — the same string
   *   `mfa_methods.totp_secret` holds and enrollment showed for manual
   *   entry.
   * @param code - the candidate code as the caller presented it.
   * @param lastStep - the step most recently accepted for this method, or
   *   `null` if none has been yet. Read from `mfa_methods.totp_last_step`.
   * @param now - defaults to the real current time; a caller (and every
   *   test in this file) supplies it explicitly to pin the window.
   * @returns `{ accepted: true, step }` for the first matching step
   *   strictly greater than `lastStep`, to be persisted back to
   *   `mfa_methods.totp_last_step`; otherwise `{ accepted: false, step }`
   *   with `step` naming only the window `now` fell in.
   */
  public verify(
    secret: string,
    code: string,
    lastStep: number | null,
    now: Date = new Date(),
  ): TotpVerificationResult {
    const currentStep = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
    // Encoded once: what varies per iteration is the code a step produces, not
    // the one the caller presented.
    const presented = Buffer.from(code, 'utf8');

    for (let delta = -WINDOW_STEPS; delta <= WINDOW_STEPS; delta += 1) {
      const candidateStep = currentStep + delta;
      if (lastStep !== null && candidateStep <= lastStep) continue;
      if (TotpVerifier.matches(this.codeAt(secret, candidateStep), presented)) {
        return { accepted: true, step: candidateStep };
      }
    }

    return { accepted: false, step: currentStep };
  }

  /** The code `secret` produces at time step `step` — see `totp-authenticator.ts` on the shared singleton. */
  private codeAt(secret: string, step: number): string {
    return totpCodeAtStep(secret, step, this.digits);
  }

  /**
   * Whether `presented` is `expected`, compared without a branch on their
   * contents.
   *
   * `common/crypto/hashOpaqueToken.ts` states the rule this follows: anything
   * that has to compare two secrets directly uses `crypto.timingSafeEqual`
   * rather than `===`. **What this buys on its own is small** — a real
   * account's code is six digits (see {@link PRODUCTION_TOTP_DIGITS}), checked
   * over a three-step window, so the timing of a `===` over two short strings
   * is a thin channel and nobody should claim otherwise. The
   * reason to write it this way is the rule rather than the exposure: a stated
   * crypto rule with an unmarked exception reads as permission, and the next
   * comparison somebody writes from this precedent may not be six digits wide.
   *
   * `timingSafeEqual` throws when its two buffers differ in length, so the
   * lengths are compared first. That branch is decided by the length of the
   * caller's own input against the length of a code this instance produces,
   * which is `digits` and is the same whatever the secret is — so it separates
   * inputs by their own size and never by the secret.
   */
  private static matches(expected: string, presented: Buffer): boolean {
    const candidate = Buffer.from(expected, 'utf8');
    return candidate.length === presented.length && timingSafeEqual(candidate, presented);
  }
}
