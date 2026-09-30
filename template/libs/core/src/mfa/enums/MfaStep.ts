/**
 * What a caller must still do before a sign-in attempt can conclude.
 *
 * A step, not a boolean, because the two outcomes are not opposites of one
 * fact — they are different instructions to the caller, and a third outcome
 * (added later without rewriting either existing member) would still fit the
 * same shape.
 */
export enum MfaStep {
  /** Nothing further is required; a session may be issued. */
  ISSUE_SESSION = 'ISSUE_SESSION',
  /** Credentials were proven, and are not enough on their own. */
  REQUIRE_SECOND_FACTOR = 'REQUIRE_SECOND_FACTOR',
}
