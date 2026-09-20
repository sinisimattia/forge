import type { UserId } from '../../users/types/UserId';
import { InvitationStatus } from '../enums/InvitationStatus';
import { OrgRole } from '../enums/OrgRole';
import type { InvitationId } from '../types/InvitationId';
import type { InvitationJSON } from '../types/InvitationJSON';
import type { MembershipId } from '../types/MembershipId';
import type { MembershipJSON } from '../types/MembershipJSON';
import type { OrganizationId } from '../types/OrganizationId';
import type { OrganizationJSON } from '../types/OrganizationJSON';

/**
 * Build a valid {@link OrganizationJSON} wire object, overriding any fields.
 *
 * The default is an ordinary live organization — named, with a slug that is
 * usable in a path, not deleted — because that is the state most tests need
 * before they change exactly one thing about it.
 *
 * @param overrides - fields to replace on the default
 * @returns a complete wire object
 */
export function makeOrganizationJSON(
  overrides: Partial<OrganizationJSON> = {},
): OrganizationJSON {
  return {
    id: 'org-1' as OrganizationId,
    name: 'Acme Works',
    slug: 'acme-works',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Build a valid {@link MembershipJSON} wire object, overriding any fields.
 *
 * The default is an ordinary MEMBER rather than an OWNER: a fixture whose
 * default carried the organization's one privileged role would make a test
 * about the last-owner invariant pass without anybody having said `OWNER`.
 *
 * @param overrides - fields to replace on the default
 * @returns a complete wire object
 */
export function makeMembershipJSON(overrides: Partial<MembershipJSON> = {}): MembershipJSON {
  return {
    id: 'membership-1' as MembershipId,
    organizationId: 'org-1' as OrganizationId,
    userId: 'user-1' as UserId,
    role: OrgRole.MEMBER,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Build a valid {@link InvitationJSON} wire object, overriding any fields.
 *
 * The default is an offer that has been made and nothing else has happened to:
 * PENDING, unaccepted, expiring a week after it was issued. Its instants are
 * fixed literals, so a test that pins one does not chase the clock — a test
 * that cares whether the invitation has lapsed sets `expiresAt` relative to the
 * instant it controls.
 *
 * @param overrides - fields to replace on the default
 * @returns a complete wire object
 */
export function makeInvitationJSON(overrides: Partial<InvitationJSON> = {}): InvitationJSON {
  return {
    id: 'invitation-1' as InvitationId,
    organizationId: 'org-1' as OrganizationId,
    email: 'invitee@example.com',
    role: OrgRole.MEMBER,
    status: InvitationStatus.PENDING,
    invitedByUserId: 'user-1' as UserId,
    expiresAt: '2026-01-08T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    acceptedAt: null,
    acceptedByUserId: null,
    ...overrides,
  };
}
