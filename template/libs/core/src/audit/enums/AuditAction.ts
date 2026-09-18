/**
 * What happened. One member per kind of event worth reconstructing later.
 *
 * Members are added by later phases and never renamed or removed: a stored
 * value that changes meaning makes every historical entry a lie, and this is a
 * table nothing is permitted to rewrite.
 */
export enum AuditAction {
  USER_REGISTERED = 'USER_REGISTERED',
  EMAIL_VERIFICATION_REQUESTED = 'EMAIL_VERIFICATION_REQUESTED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  LOGIN_SUCCEEDED = 'LOGIN_SUCCEEDED',
  /** Recorded with the reason, which the person attempting it is never told. */
  LOGIN_FAILED = 'LOGIN_FAILED',
  SESSION_RENEWED = 'SESSION_RENEWED',
  /** Recorded when a credential that has already been used is presented again. */
  SESSION_REUSE_DETECTED = 'SESSION_REUSE_DETECTED',
  LOGGED_OUT = 'LOGGED_OUT',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ALL_SESSIONS_REVOKED = 'ALL_SESSIONS_REVOKED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  IDENTITY_UNLINKED = 'IDENTITY_UNLINKED',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  USER_STATUS_CHANGED = 'USER_STATUS_CHANGED',
  PLATFORM_ROLE_CHANGED = 'PLATFORM_ROLE_CHANGED',
  /** Every time platform administration is used to pass a check that would otherwise deny. */
  PLATFORM_ADMIN_OVERRIDE = 'PLATFORM_ADMIN_OVERRIDE',
}
