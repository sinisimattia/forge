/**
 * How an authentication attempt ended.
 *
 * Three members: a deployment that requires a second factor has an ending
 * that is neither success nor failure but "not yet" — `MFA_REQUIRED`. The
 * values are the member names rather than ordinals, for the reason every enum
 * in this package gives — a numeric enum stores a position, so reordering the
 * members silently reassigns everything already written.
 */
export enum AuthenticationStatus {
  /** The person proved the account is theirs, and a session now exists. */
  AUTHENTICATED = 'AUTHENTICATED',
  /** The attempt failed. Why it failed is recorded, never returned. */
  REJECTED = 'REJECTED',
  /** Credentials were proven and are not enough; a second factor is owed. */
  MFA_REQUIRED = 'MFA_REQUIRED',
}
