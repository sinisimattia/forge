/**
 * Whether removing a method may proceed on the strength of the requesting
 * session alone.
 *
 * Removing a second factor is a way to remove it as a requirement, so the
 * decision is modelled explicitly rather than left to whichever check the
 * caller happens to run first: a session that has not itself proven the
 * second factor recently must be asked for it before it can take that factor
 * away.
 */
export enum MfaRemovalDecision {
  /** The session that asked is sufficient. */
  ALLOWED = 'ALLOWED',
  /** A live proof of the second factor must accompany the request. */
  REAUTHENTICATION_REQUIRED = 'REAUTHENTICATION_REQUIRED',
}
