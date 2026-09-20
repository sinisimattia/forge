import { Invitation, Membership, Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  makeInvitationJSON,
  makeMembershipJSON,
  makeOrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/testing';
import type {
  InvitationId,
  MembershipId,
  OrganizationId,
} from '__FORGE_SCOPE__/core/organizations/types';

describe('makeOrganizationJSON', () => {
  // Against literals, not against a function of the value under test: the
  // latter holds for whatever the fixture happens to return, so it could not fail.
  it('defaults to a live organization with a slug that is usable in a path', () => {
    const json = makeOrganizationJSON();
    expect(json.name).toBe('Acme Works');
    expect(json.slug).toBe('acme-works');
    expect(json.deletedAt).toBeNull();
  });

  it('defaults to fixed instants, so a test that pins one does not chase the clock', () => {
    expect(makeOrganizationJSON().createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(makeOrganizationJSON().updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('builds something the entity accepts', () => {
    expect(Organization.fromJSON(makeOrganizationJSON())).toBeInstanceOf(Organization);
  });

  it('lets an override win over the default', () => {
    const json = makeOrganizationJSON({ id: 'org-9' as OrganizationId, slug: 'nine' });
    expect(json.id).toBe('org-9');
    expect(json.slug).toBe('nine');
    expect(json.name).toBe('Acme Works');
  });
});

describe('makeMembershipJSON', () => {
  // MEMBER rather than OWNER: a default carrying the organization's one
  // privileged role would make a test about the last-owner invariant pass
  // without anybody having said OWNER.
  it('defaults to an ordinary MEMBER', () => {
    expect(makeMembershipJSON().role).toBe(OrgRole.MEMBER);
  });

  it('defaults to naming the seeded organization and the seeded user', () => {
    expect(makeMembershipJSON().organizationId).toBe('org-1');
    expect(makeMembershipJSON().userId).toBe('user-1');
  });

  it('builds something the entity accepts', () => {
    expect(Membership.fromJSON(makeMembershipJSON())).toBeInstanceOf(Membership);
  });

  it('lets an override win over the default', () => {
    const json = makeMembershipJSON({ id: 'membership-9' as MembershipId, role: OrgRole.OWNER });
    expect(json.id).toBe('membership-9');
    expect(json.role).toBe(OrgRole.OWNER);
    expect(json.userId).toBe('user-1');
  });
});

describe('makeInvitationJSON', () => {
  it('defaults to an offer nothing has happened to yet', () => {
    const json = makeInvitationJSON();
    expect(json.status).toBe(InvitationStatus.PENDING);
    expect(json.acceptedAt).toBeNull();
    expect(json.acceptedByUserId).toBeNull();
  });

  it('defaults to offering an ordinary MEMBER role', () => {
    expect(makeInvitationJSON().role).toBe(OrgRole.MEMBER);
  });

  it('defaults to expiring a week after it was issued', () => {
    const json = makeInvitationJSON();
    expect(json.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(json.expiresAt).toBe('2026-01-08T00:00:00.000Z');
  });

  it('builds something the entity accepts', () => {
    expect(Invitation.fromJSON(makeInvitationJSON())).toBeInstanceOf(Invitation);
  });

  it('lets an override win over the default', () => {
    const json = makeInvitationJSON({
      id: 'invitation-9' as InvitationId,
      status: InvitationStatus.REVOKED,
    });
    expect(json.id).toBe('invitation-9');
    expect(json.status).toBe(InvitationStatus.REVOKED);
    expect(json.role).toBe(OrgRole.MEMBER);
  });
});
