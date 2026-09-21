import { runIAuthorizationServiceContract } from '__FORGE_SCOPE__/core/authorization/testing';
import type { GrantId, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { adaptJestToConformanceExpect, makeTenancyWorld } from '../../common/testing';

/**
 * `AuthorizationService` against core's `IAuthorizationService` suite.
 *
 * A gate; it produces nothing. See `organizations.conformance.spec.ts` for what
 * driving a shared suite from a real implementation establishes (D3).
 *
 * ## The world this suite needs is the opposite of the security suite's
 *
 * `makeTenancyWorld` promises two organizations whose memberships do **not**
 * overlap, because every cross-tenant refusal the security suite asserts is
 * vacuous without that. This suite requires the reverse of part of it: its
 * `actorId` and `subjectUserId` must both be members of *both* organizations, so
 * that "a grant is confined to the organization it was issued in" is a statement
 * about the grant rather than about the people. Two accounts are therefore
 * joined into both through `TenancyWorld.join`, which drives the real invitation
 * path.
 *
 * That does not weaken the other suite: each driver builds its own world. The
 * disjointness the security suite relies on is a property of the world *it* is
 * handed, and nothing here touches it.
 *
 * `outsiderId` is the world's own `memberB` — somebody who belongs to B and not
 * to A. Deliberately not somebody who belongs to nothing: the suite's deps say
 * why, and it is the difference between a refusal about a boundary and a refusal
 * about an account with no memberships at all.
 *
 * ## Two obligations this driver has to meet rather than assert
 *
 * - **Neither organization holds a grant when the world is built.** Every count
 *   the suite asserts is a count of what the suite itself issued, so a seeded
 *   grant would put every total off by one and blame the implementation.
 *   `makeTenancyWorld` issues none, and nothing below issues one either.
 * - **`actorId` and `subjectUserId` are different people.** "The actor is
 *   recorded as the issuer" cannot fail in a world where they are the same, and
 *   the suite asserts the promise before relying on it.
 */

/**
 * A kind of record this store accepts.
 *
 * `ResourceType` is an unvalidated branded string on purpose — core does not
 * know what a deployment's records are called — and this backend stores it as
 * text with no vocabulary of its own, so any noun serves. It is not a
 * deployment's real resource name because there is not one yet: no `can()` call
 * site passes `resourceType` at all (see `PermissionsGuard`).
 */
const RESOURCE_TYPE = 'document' as ResourceType;

runIAuthorizationServiceContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  // Well-formed for this store — ids here are `fake-<Entity>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentGrantId: 'fake-ResourceGrantRecord-absent' as GrantId,
  makeContext: async () => {
    const world = await makeTenancyWorld();

    const actor = world.seedAccount('conformance-actor@example.test', 'Actor');
    const subject = world.seedAccount('conformance-subject@example.test', 'Subject');
    for (const account of [actor, subject]) {
      await world.join(world.ownerA.id, world.orgA.id, account, OrgRole.ADMIN);
      await world.join(world.ownerB.id, world.orgB.id, account, OrgRole.ADMIN);
    }

    return {
      service: world.authorization,

      organizationId: world.orgA.id,
      otherOrganizationId: world.orgB.id,
      actorId: actor.id,
      subjectUserId: subject.id,
      outsiderId: world.memberB.id,
      resourceType: RESOURCE_TYPE,
      now: world.now,
    };
  },
});
