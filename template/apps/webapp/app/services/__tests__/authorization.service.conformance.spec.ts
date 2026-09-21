import { describe, it } from 'vitest';
import { runIAuthorizationServiceContract } from '__FORGE_SCOPE__/core/authorization/testing';
import type { GrantId, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  MembershipJSON,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { AuthorizationHttpService } from '~/services/authorization.service';
import { adaptVitestToConformanceExpect } from '~/test/adapt-vitest';
import { stubBackend } from './stubBackend';

/**
 * `AuthorizationHttpService` against core's shared `IAuthorizationService`
 * suite — the same suite the backend's `AuthorizationService` is driven
 * through, under a different runner (DEC-1).
 *
 * A gate; it produces nothing. See `organization.service.conformance.spec.ts`
 * for what driving a shared suite from a real implementation establishes,
 * and why tenant isolation is not asserted here either.
 *
 * ## The world this suite needs
 *
 * `actorId` and `subjectUserId` must both be members of **both**
 * organizations, so that "a grant is confined to the organization it was
 * issued in" is a statement about the grant rather than about the people —
 * see `IAuthorizationServiceContractDeps`'s own TSDoc. `outsiderId` belongs
 * to the second organization and not the first: deliberately not somebody
 * who belongs to nothing, because a refusal that only held for an account
 * with no memberships at all would say nothing about a boundary.
 *
 * Neither organization holds a grant when this world is built — every count
 * the suite asserts is a count of what the suite itself issues.
 */

const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/**
 * A kind of record this store accepts.
 *
 * `ResourceType` is an unvalidated branded string on purpose — core does not
 * know what a deployment's records are called — so any noun serves.
 */
const RESOURCE_TYPE = 'document' as ResourceType;

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

runIAuthorizationServiceContract({
  describe,
  it,
  expect: adaptVitestToConformanceExpect(),
  // Well-formed for this store — ids here are `stub-<Thing>-<n>` — and held
  // by no world this factory builds. The suite cannot invent one; see its
  // deps.
  absentGrantId: 'stub-Grant-absent' as GrantId,
  makeContext: async () => {
    const backend = stubBackend();

    const actorJson = seedUser('stub-User-1', 'actor@example.test', 'Actor');
    const subjectJson = seedUser('stub-User-2', 'subject@example.test', 'Subject');
    const outsiderJson = seedUser('stub-User-3', 'outsider@example.test', 'Outsider');
    backend.putUser(actorJson, PLAINTEXT);
    backend.putUser(subjectJson, PLAINTEXT);
    backend.putUser(outsiderJson, PLAINTEXT);

    const orgAJson = seedOrganization('stub-Organization-1', 'Org A', 'org-a');
    const orgBJson = seedOrganization('stub-Organization-2', 'Org B', 'org-b');
    backend.putOrganization(orgAJson);
    backend.putOrganization(orgBJson);

    // `actor` and `subject` belong to both organizations.
    backend.putMembership(
      seedMembership('stub-Membership-1', orgAJson.id, actorJson.id, OrgRole.ADMIN),
    );
    backend.putMembership(
      seedMembership('stub-Membership-2', orgBJson.id, actorJson.id, OrgRole.ADMIN),
    );
    backend.putMembership(
      seedMembership('stub-Membership-3', orgAJson.id, subjectJson.id, OrgRole.MEMBER),
    );
    backend.putMembership(
      seedMembership('stub-Membership-4', orgBJson.id, subjectJson.id, OrgRole.MEMBER),
    );
    // `outsider` belongs to B only — a real member somewhere, and still not
    // grantable in A, which is what makes the refusal about the boundary
    // rather than about the account.
    backend.putMembership(
      seedMembership('stub-Membership-5', orgBJson.id, outsiderJson.id, OrgRole.MEMBER),
    );

    return {
      service: new AuthorizationHttpService(backend.client),

      organizationId: orgAJson.id,
      otherOrganizationId: orgBJson.id,
      actorId: actorJson.id,
      subjectUserId: subjectJson.id,
      outsiderId: outsiderJson.id,
      resourceType: RESOURCE_TYPE,
      now: new Date(),
    };
  },
});
