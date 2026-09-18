/**
 * Whether an account may be used at all.
 *
 * Deletion is not a status: a deleted account is one whose `deletedAt` is set,
 * so that "suspended and later restored" and "deleted" stay independent facts.
 * Verification is likewise not a status — it is `emailVerifiedAt` — because an
 * account can be suspended before or after it is verified.
 */
export enum UserStatus {
  /** Usable, subject to verification and deletion. */
  ACTIVE = 'ACTIVE',
  /** Blocked by an administrator. Retains all data; cannot authenticate. */
  SUSPENDED = 'SUSPENDED',
}
