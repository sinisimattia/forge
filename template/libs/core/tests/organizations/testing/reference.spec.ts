import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { OrganizationServiceContractContext } from '__FORGE_SCOPE__/core/organizations/testing';
import {
  makeMembershipJSON,
  makeOrganizationJSON,
  runIOrganizationServiceContract,
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

const ORGANIZATION_ID = 'org-seeded' as OrganizationId;

/**
 * The opaque value this world redeems nothing with.
 *
 * Bound to a name of its own and referenced below, rather than written inline,
 * so the use site reads as "the value this world redeems nothing with" rather
 * than as an opaque string. The name carries the meaning and the literal is
 * written once, here.
 */
const REDEEMS_NOTHING = 'no-such-value';

/**
 * The four accounts this world holds.
 *
 * Three of them are members of the one organization and the fourth belongs to
 * nothing, which is what makes "lists only organizations the actor belongs to"
 * and the invitation assertions able to fail.
 */
const PEOPLE = {
  owner: makeUserJSON({ id: 'user-owner' as UserId, email: 'owner@example.com', displayName: 'Ada' }),
  admin: makeUserJSON({ id: 'user-admin' as UserId, email: 'admin@example.com', displayName: 'Grace' }),
  member: makeUserJSON({ id: 'user-member' as UserId, email: 'member@example.com', displayName: 'Alan' }),
  outsider: makeUserJSON({
    id: 'user-outsider' as UserId,
    email: 'outsider@example.com',
    displayName: 'Katherine',
  }),
};

/** The role each of the three members holds, exactly as the deps interface promises. */
const ROLES: ReadonlyArray<readonly [UserJSON, OrgRole]> = [
  [PEOPLE.owner, OrgRole.OWNER],
  [PEOPLE.admin, OrgRole.ADMIN],
  [PEOPLE.member, OrgRole.MEMBER],
];

/**
 * A fresh world: one organization whose only owner is `owner`, with an ADMIN
 * and an ordinary MEMBER beside them, and one account that belongs to nothing.
 *
 * Every promised value is built from the rows this seeds — never from anything
 * the service returned. A world that built its own fixtures by calling the
 * implementation under test would make the suite's comparisons values compared
 * with themselves, which is the one way a green suite can mean nothing.
 */
async function makeContext(): Promise<OrganizationServiceContractContext> {
  const service = new InMemoryOrganizationService();
  for (const row of Object.values(PEOPLE)) service.seedUser(row);

  const organizationRow = makeOrganizationJSON({
    id: ORGANIZATION_ID,
    name: 'Acme Works',
    slug: 'acme-works',
  });
  service.seedOrganization(organizationRow);

  for (const [person, role] of ROLES) {
    service.seedMembership(makeMembershipJSON({
      id: `membership-${person.id}` as MembershipId,
      organizationId: ORGANIZATION_ID,
      userId: person.id,
      role,
    }));
  }

  return {
    service,
    // Through the reviver, which is what the entity the service returns is built
    // through too — so each comparison is between two entities, not between an
    // entity and the row one of them came from.
    organization: Organization.fromJSON(organizationRow),
    owner: User.fromJSON(PEOPLE.owner),
    admin: User.fromJSON(PEOPLE.admin),
    member: User.fromJSON(PEOPLE.member),
    outsider: User.fromJSON(PEOPLE.outsider),
    uninvitedEmail: 'nobody@example.com',
    tokenFor: async (invitation) => service.tokenFor(invitation.id),
    now: new Date(),
  };
}

runIOrganizationServiceContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
  // Well-formed for this store — its keys are plain strings — and in no world.
  absentOrganizationId: 'no-such-organization' as OrganizationId,
  absentInvitationId: 'no-such-invitation' as InvitationId,
  absentToken: REDEEMS_NOTHING,
});
