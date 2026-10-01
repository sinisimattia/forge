/**
 * Whether confirming a second factor may proceed on the strength of the
 * requesting session alone.
 *
 * Modelled rather than left to whichever check a caller happens to run first,
 * for the reason {@link MfaRemovalDecision} is: adding a factor and removing
 * one are the two ways the set of things that can prove this account changes,
 * and a decision that exists for one and not the other is a gap shaped exactly
 * like the way around it.
 */
export enum MfaEnrollmentDecision {
  /** The session that asked is sufficient. */
  ALLOWED = 'ALLOWED',
  /** A live proof from a factor the account already holds must accompany the request. */
  REAUTHENTICATION_REQUIRED = 'REAUTHENTICATION_REQUIRED',
}
