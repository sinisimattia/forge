/**
 * How an authentication attempt ended.
 *
 * Two members today, and deliberately open to more: a deployment that requires
 * a second factor introduces an ending that is neither success nor failure but
 * "not yet". The values are the member names rather than ordinals, for the
 * reason every enum in this package gives — a numeric enum stores a position,
 * so reordering the members silently reassigns everything already written.
 */
export enum AuthenticationStatus {
  /** The person proved the account is theirs, and a session now exists. */
  AUTHENTICATED = 'AUTHENTICATED',
  /** The attempt failed. Why it failed is recorded, never returned. */
  REJECTED = 'REJECTED',
}
