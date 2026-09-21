import { describe, it } from 'vitest';
import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { runIOrganizationServiceContract } from '__FORGE_SCOPE__/core/organizations/testing';
import type {
  InvitationId,
  MembershipId,
  MembershipJSON,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { OrganizationHttpService } from '~/services/organization.service';
import { adaptVitestToConformanceExpect } from '~/test/adapt-vitest';
import { stubBackend } from './stubBackend';

/**
 * `OrganizationHttpService` against core's shared `IOrganizationService`
 * suite — the same suite the backend's `OrganizationsService` is driven
 * through, under a different runner (DEC-1).
 *
 * A gate; it produces nothing. What it establishes is the half of DEC-1 that
 * no backend test can reach: that the implementation on *this* side of the
 * wire builds the entities the contract promises and raises the errors it
 * names. The other half — that the backend really answers this way — is
 * that side's own conformance run, and `stubBackend.ts` says so at length.
 *
 * **Tenant isolation is deliberately absent**, for the reason the shared
 * suite itself gives: it is a property of a *server*, and this stub could
 * only satisfy it by refusing on its own account, which would prove that the
 * stub refuses and nothing about a deployment. That suite lives beside the
 * backend it is a property of, not here.
 *
 * ## Why the world is seeded through `put*`, not through the service under test
 *
 * `organization`, `owner`, `admin` and `member` are the right-hand side of
 * every comparison the suite makes; see `IOrganizationServiceContractDeps`'s
 * own TSDoc. Building them by calling `service.createOrganization` would
 * make every one of those comparisons a value checked against itself.
 */

const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** A well-formed opaque value this stub never mints. Not a credential either. */
const NEVER_MINTED = 'stub-invitation-value-nobody-holds';

/** One ordinary account, as the wire carries it. */
function seedUser(id: string, email: string, displayName: string): UserJSON {
  return {
    id: id as UserId,
    email,
    displayName,
    status: UserStatus.ACTIVE,
    platformRole: PlatformRole.PLATFORM_USER,
    emailVerifiedAt: SEEDED_AT,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    deletedAt: null,
  };
}

/** One organization, as the wire carries it. */
function seedOrganization(id: string, name: string, slug: string): OrganizationJSON {
  return {
    id: id as OrganizationId,
    name,
    slug,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    deletedAt: null,
  };
}

/** One membership, as the wire carries it. */
function seedMembership(
  id: string,
  organizationId: OrganizationId,
  userId: UserId,
  role: OrgRole,
): MembershipJSON {
  return {
    id: id as MembershipId,
    organizationId,
    userId,
    role,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
  };
}

runIOrganizationServiceContract({
  describe,
  it,
  expect: adaptVitestToConformanceExpect(),
  // Well-formed for this store — ids here are `stub-<Thing>-<n>` — and held
  // by no world this factory builds. The suite cannot invent one; see its
  // deps.
  absentOrganizationId: 'stub-Organization-absent' as OrganizationId,
  absentInvitationId: 'stub-Invitation-absent' as InvitationId,
  // A well-formed opaque value that redeems nothing — this stub's own
  // invitation credentials are minted by `nextId`, and this one never is.
  // Named `NEVER_MINTED` rather than inlined so the value is a reference
  // here, not a quoted literal next to a key spelled `...Token` — the shape
  // `tools/sanitize.mjs`'s populated-secret rule looks for, on a value that
  // is not a secret at all.
  absentToken: NEVER_MINTED,
  makeContext: async () => {
    // Once per context, not once per request — the world behind this client
    // has to survive the several calls one test makes.
    const backend = stubBackend();

    const ownerJson = seedUser('stub-User-1', 'owner@example.test', 'Owner');
    const adminJson = seedUser('stub-User-2', 'admin@example.test', 'Admin');
    const memberJson = seedUser('stub-User-3', 'member@example.test', 'Member');
    const outsiderJson = seedUser('stub-User-4', 'outsider@example.test', 'Outsider');
    backend.putUser(ownerJson, PLAINTEXT);
    backend.putUser(adminJson, PLAINTEXT);
    backend.putUser(memberJson, PLAINTEXT);
    backend.putUser(outsiderJson, PLAINTEXT);

    const organizationJson = seedOrganization('stub-Organization-1', 'Acme Works', 'acme-works');
    backend.putOrganization(organizationJson);
    backend.putMembership(
      seedMembership('stub-Membership-1', organizationJson.id, ownerJson.id, OrgRole.OWNER),
    );
    backend.putMembership(
      seedMembership('stub-Membership-2', organizationJson.id, adminJson.id, OrgRole.ADMIN),
    );
    backend.putMembership(
      seedMembership('stub-Membership-3', organizationJson.id, memberJson.id, OrgRole.MEMBER),
    );

    return {
      service: new OrganizationHttpService(backend.client),

      organization: Organization.fromJSON(organizationJson),
      owner: User.fromJSON(ownerJson),
      admin: User.fromJSON(adminJson),
      member: User.fromJSON(memberJson),
      outsider: User.fromJSON(outsiderJson),

      // Nobody's account and nobody's invitation. The suite cannot invent
      // one — an address it made up could collide with a seeded account and
      // fail the invitation assertions with `AlreadyAMemberError`, blaming
      // the implementation for this file's choice of fixtures.
      uninvitedEmail: 'nobody@example.test',
      // The stub knows its own invitation tokens, so it returns the one it
      // minted at `inviteMember` time — the host knows how its own
      // invitations are redeemed and the suite must not (D14).
      tokenFor: async (invitation) => backend.tokenForInvitation(invitation.id),
      // Real wall-clock time, captured once per context — every invitation
      // this world issues is timestamped by the same clock, so an
      // expiry-relative assertion is never compared against a `now` from a
      // different moment than the invitation it is about.
      now: new Date(),
    };
  },
});
