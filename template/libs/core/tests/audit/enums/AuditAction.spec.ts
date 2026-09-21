/**
 * The append-only audit log stores action values in the database.
 * A renamed member breaks at compile time: every `AuditAction.X` reference stops compiling.
 * A changed string value does not: the reference still compiles, tests stay green,
 * and the audit table starts recording a different value while every row already in it
 * carries the old one. Two names for one event, in a table nothing is permitted to correct.
 *
 * This spec pins the value, not just the name. Changing a value fails here.
 * Adding a member without adding it to this map also fails.
 */

import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';

describe('AuditAction enum values', () => {
  // Written out in full, not derived from the enum.
  // Deriving the expectation from the thing it checks is a tautology.
  const EXPECTED_VALUES: Record<keyof typeof AuditAction, string> = {
    USER_REGISTERED: 'USER_REGISTERED',
    DUPLICATE_REGISTRATION_ATTEMPTED: 'DUPLICATE_REGISTRATION_ATTEMPTED',
    EMAIL_VERIFICATION_REQUESTED: 'EMAIL_VERIFICATION_REQUESTED',
    EMAIL_VERIFIED: 'EMAIL_VERIFIED',
    LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
    LOGIN_FAILED: 'LOGIN_FAILED',
    SESSION_RENEWED: 'SESSION_RENEWED',
    SESSION_REUSE_DETECTED: 'SESSION_REUSE_DETECTED',
    LOGGED_OUT: 'LOGGED_OUT',
    SESSION_REVOKED: 'SESSION_REVOKED',
    ALL_SESSIONS_REVOKED: 'ALL_SESSIONS_REVOKED',
    PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
    PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
    IDENTITY_UNLINKED: 'IDENTITY_UNLINKED',
    PROFILE_UPDATED: 'PROFILE_UPDATED',
    ACCOUNT_DELETED: 'ACCOUNT_DELETED',
    USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
    PLATFORM_ROLE_CHANGED: 'PLATFORM_ROLE_CHANGED',
    PLATFORM_ADMIN_OVERRIDE: 'PLATFORM_ADMIN_OVERRIDE',
    ORGANIZATION_CREATED: 'ORGANIZATION_CREATED',
    ORGANIZATION_UPDATED: 'ORGANIZATION_UPDATED',
    ORGANIZATION_DELETED: 'ORGANIZATION_DELETED',
    MEMBER_INVITED: 'MEMBER_INVITED',
    INVITATION_REVOKED: 'INVITATION_REVOKED',
    INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
    MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED',
    MEMBER_REMOVED: 'MEMBER_REMOVED',
    GRANT_CREATED: 'GRANT_CREATED',
    GRANT_REVOKED: 'GRANT_REVOKED',
    IDENTITY_LINKED: 'IDENTITY_LINKED',
    FEDERATED_LINK_REFUSED: 'FEDERATED_LINK_REFUSED',
  };

  it('every member has the expected string value', () => {
    for (const [key, expected] of Object.entries(EXPECTED_VALUES)) {
      expect((AuditAction as Record<string, string>)[key]).toBe(expected);
    }
  });

  it('every enum member is in the expected values map', () => {
    const enumKeys = Object.keys(AuditAction);
    expect(enumKeys.sort()).toEqual(Object.keys(EXPECTED_VALUES).sort());
  });
});
