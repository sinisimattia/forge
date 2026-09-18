/**
 * Why an authentication attempt failed.
 *
 * **This is server-side knowledge and is never returned to whoever made the
 * attempt.** It exists so the audit record can say precisely what happened. A
 * caller is told only that the attempt failed: an answer that distinguished
 * "no such account" from "wrong secret" would let anyone test an address for
 * existence, one attempt at a time. The identical-answer rule is asserted by
 * {@link runIAuthServiceSecurityContract} and is the reason this enum is part
 * of no wire shape.
 */
export enum AuthenticationRejectionReason {
  /** No account answers to that address. */
  UNKNOWN_ACCOUNT = 'UNKNOWN_ACCOUNT',
  /** An account answers to it, but the secret offered was not its own. */
  INVALID_SECRET = 'INVALID_SECRET',
  /** The address has never been proven, so the account may not be used yet. */
  EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED',
  /** An administrator has blocked the account. */
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  /** The account was soft-deleted and is not to be resurrected by signing in. */
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
}
