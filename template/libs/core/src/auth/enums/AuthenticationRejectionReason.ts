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
 *
 * **When more than one applies, the order is fixed and is part of the contract.**
 * `INVALID_SECRET` is decided first: whoever does not hold the secret is told
 * nothing about the account behind the address, so no state of that account may
 * be reachable ahead of it. Among the states, the order is `ACCOUNT_DELETED`,
 * then `ACCOUNT_SUSPENDED`, then `EMAIL_NOT_VERIFIED` — most permanent first, so
 * that the recorded reason is the one that would still be true after the others
 * were fixed. An account that was never verified and has since been deleted is
 * recorded as deleted, because verifying it now would change nothing.
 *
 * The purpose of the order — and it has one, which is why it is not a detail to
 * be simplified away — is that the recorded reason must never imply a remedy
 * that would not work. Recording `EMAIL_NOT_VERIFIED` against a suspended
 * account tells whoever reads that entry later "verify the address and you are
 * in", which is false; they act on it, and the record has cost them the time it
 * existed to save. The most permanent applicable state is the only one whose
 * remedy is the real one.
 *
 * The order is stated here rather than left to each implementation because this
 * is what is written to the audit record: two implementations that disagreed
 * would produce two different histories of the same event, and a reader of one
 * could not compare it with the other.
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
