/**
 * What happened. One member per kind of event worth reconstructing later.
 *
 * Members are added by later phases and never renamed or removed: a stored
 * value that changes meaning makes every historical entry a lie, and this is a
 * table nothing is permitted to rewrite.
 */
export enum AuditAction {
  USER_REGISTERED = 'USER_REGISTERED',
  /**
   * Somebody tried to bring an account into being at an address that already has
   * one.
   *
   * It exists because the alternative was a false entry. Registration answers a
   * known address and an unknown one identically — that silence is the whole
   * design — and what makes the silence affordable is that the *server* still
   * knows which of the two happened and writes it down. Recording that as
   * {@link AuditAction.USER_REGISTERED} would say an account was created when
   * none was; recording it as {@link AuditAction.EMAIL_VERIFICATION_REQUESTED}
   * would say a verification was asked for when none was issued and none was
   * sent. Either one destroys the only thing the entry is for, in a table
   * nothing is permitted to correct afterwards.
   *
   * The actor is the account that already existed, not whoever made the attempt
   * — nothing about them has been established, which is the point.
   */
  DUPLICATE_REGISTRATION_ATTEMPTED = 'DUPLICATE_REGISTRATION_ATTEMPTED',
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
  ORGANIZATION_CREATED = 'ORGANIZATION_CREATED',
  ORGANIZATION_UPDATED = 'ORGANIZATION_UPDATED',
  ORGANIZATION_DELETED = 'ORGANIZATION_DELETED',
  MEMBER_INVITED = 'MEMBER_INVITED',
  /** An invitation withdrawn by an organization before anybody accepted it. */
  INVITATION_REVOKED = 'INVITATION_REVOKED',
  INVITATION_ACCEPTED = 'INVITATION_ACCEPTED',
  MEMBER_ROLE_CHANGED = 'MEMBER_ROLE_CHANGED',
  MEMBER_REMOVED = 'MEMBER_REMOVED',
  GRANT_CREATED = 'GRANT_CREATED',
  GRANT_REVOKED = 'GRANT_REVOKED',
}
