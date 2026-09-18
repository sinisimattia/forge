/**
 * The rules a deployment applies when judging a phrase a person proposes.
 *
 * Every knob is stated here rather than read from anywhere, so the same phrase
 * judged twice by the same policy always gets the same answer, and a test can
 * state the policy it means instead of arranging for one.
 */
export interface PasswordPolicy {
  /** The shortest acceptable phrase. Length is where almost all the strength is. */
  minLength: number;
  /**
   * The longest acceptable phrase. A bound exists because a derivation's cost
   * grows with its input, so an unbounded phrase is a way to make a server do
   * unbounded work.
   */
  maxLength: number;
  /** Whether a phrase must carry both an upper-case and a lower-case letter. */
  requireMixedCase: boolean;
  /** Whether a phrase must carry at least one digit. */
  requireDigit: boolean;
}
