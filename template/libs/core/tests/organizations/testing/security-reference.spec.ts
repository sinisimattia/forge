import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { OrganizationServiceSecurityContractContext } from '__FORGE_SCOPE__/core/organizations/testing';
import {
  makeMembershipJSON,
  makeOrganizationJSON,
  runIOrganizationServiceSecurityContract,
} from '__FORGE_SCOPE__/core/organizations/testing';
import type {
  InvitationId,
  MembershipId,
  OrganizationId,
} from '__FORGE_SCOPE__/core/organizations/types';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { makeUserJSON } from '__FORGE_SCOPE__/core/users/testing';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';
import { InMemoryOrganizationService } from './InMemoryOrganizationService';

/**
 * The reference implementation against the **tenant-isolation** suite.
 *
 * `reference.spec.ts` beside this file does the same for the shared suite, and
 * the reason both exist is the reason given there: writing an implementation is
 * the cheapest possible proof that the contract is implementable at all, and it
 * is what lets each assertion be watched failing by breaking the reference in
 * the one way that assertion exists to catch.
 *
 * **This is not the driver DEC-1 is about.** The split DEC-1 draws is between
 * *shipped* implementations — the server drives this suite, the client does not,
 * because a client could satisfy it only by refusing on its own account. A
 * reference store written beside the suite is neither; it is here so the suite
 * is executable and covered without a server, exactly as
 * `runIAuthServiceSecurityContract.spec.ts` is.
 *
 * ## The world
 *
 * Two organizations whose memberships do not overlap — the deps interface's
 * central obligation, and the one it cannot check for itself. Five accounts:
 * three in A's world (two of which the suite names), two in B's, and one
 * belonging to nothing that holds the address B's open invitation was sent to.
 *
 * B's invitation is issued through `inviteMember` rather than seeded, because
 * this store has no operation that writes an invitation row directly. That makes
 * it the one value here the service under test produced, and it is a world
 * *promise* rather than a right-hand side: every assertion that uses it compares
 * something else against it, and the suite states the promise (`PENDING`, open
 * as of `now`) as its own assertion before relying on it.
 */

const ORG_A = 'org-a' as OrganizationId;
const ORG_B = 'org-b' as OrganizationId;

const PEOPLE = {
  owner: makeUserJSON({ id: 'user-owner-a' as UserId, email: 'owner-a@example.com', displayName: 'Ada' }),
  member: makeUserJSON({ id: 'user-member-a' as UserId, email: 'member-a@example.com', displayName: 'Alan' }),
  otherOwner: makeUserJSON({ id: 'user-owner-b' as UserId, email: 'owner-b@example.com', displayName: 'Barbara' }),
  otherMember: makeUserJSON({ id: 'user-member-b' as UserId, email: 'member-b@example.com', displayName: 'Edsger' }),
  outsider: makeUserJSON({ id: 'user-outsider' as UserId, email: 'outsider@example.com', displayName: 'Katherine' }),
};

/** Who belongs where, and in what role. Disjoint by construction. */
const MEMBERSHIPS: ReadonlyArray<readonly [OrganizationId, UserJSON, OrgRole]> = [
  [ORG_A, PEOPLE.owner, OrgRole.OWNER],
  [ORG_A, PEOPLE.member, OrgRole.MEMBER],
  [ORG_B, PEOPLE.otherOwner, OrgRole.OWNER],
  [ORG_B, PEOPLE.otherMember, OrgRole.MEMBER],
];

async function makeContext(): Promise<OrganizationServiceSecurityContractContext> {
  const service = new InMemoryOrganizationService();
  for (const row of Object.values(PEOPLE)) service.seedUser(row);

  const organizationRow = makeOrganizationJSON({ id: ORG_A, name: 'Acme Works', slug: 'acme-works' });
  const otherRow = makeOrganizationJSON({
    id: ORG_B,
    name: 'Beta Industries',
    slug: 'beta-industries',
  });
  service.seedOrganization(organizationRow);
  service.seedOrganization(otherRow);

  for (const [organizationId, person, role] of MEMBERSHIPS) {
    service.seedMembership(makeMembershipJSON({
      id: `membership-${organizationId}-${person.id}` as MembershipId,
      organizationId,
      userId: person.id,
      role,
    }));
  }

  const otherInvitation = await service.inviteMember(PEOPLE.otherOwner.id, ORG_B, {
    email: PEOPLE.outsider.email,
    role: OrgRole.MEMBER,
  });

  return {
    service,
    // Through the reviver, which is what the entity the service returns is built
    // through too — so each comparison is between two entities, not between an
    // entity and the row one of them came from.
    organization: Organization.fromJSON(organizationRow),
    owner: User.fromJSON(PEOPLE.owner),
    member: User.fromJSON(PEOPLE.member),

    otherOrganization: Organization.fromJSON(otherRow),
    otherOwner: User.fromJSON(PEOPLE.otherOwner),
    otherMember: User.fromJSON(PEOPLE.otherMember),

    otherInvitation,
    otherInvitationToken: service.tokenFor(otherInvitation.id),
    outsider: User.fromJSON(PEOPLE.outsider),

    now: new Date(),
  };
}

runIOrganizationServiceSecurityContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
  // Well-formed for this store — its keys are plain strings — and in no world.
  absentOrganizationId: 'no-such-organization' as OrganizationId,
  absentInvitationId: 'no-such-invitation' as InvitationId,
});
