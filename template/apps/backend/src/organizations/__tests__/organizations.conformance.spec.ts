import { runIOrganizationServiceContract } from '__FORGE_SCOPE__/core/organizations/testing';
import type { InvitationId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { generateOpaqueToken } from '../../common/crypto';
import { adaptJestToConformanceExpect, makeTenancyWorld } from '../../common/testing';

/**
 * `OrganizationsService` against core's **shared** `IOrganizationService` suite.
 *
 * A gate; it produces nothing. What driving a shared suite from a real
 * implementation establishes is what `users.conformance.spec.ts` says it is
 * (D3): until a suite has been satisfied by something other than a reference
 * implementation written in the same file that asserts it, it proves that its
 * assertions are self-consistent and nothing about whether they describe
 * anything.
 *
 * **Tenant isolation is not here**, and its absence is the design rather than an
 * omission. The shared suite says so itself, and the backend-only suite that
 * does carry it is driven next door in
 * `organizations.security.conformance.spec.ts`. Anything cross-tenant that looks
 * like it belongs in this file belongs in that one.
 *
 * ## The world, and what it is allowed to promise
 *
 * `makeTenancyWorld` builds two organizations; this driver hands the suite the
 * first and the people in it. The second is invisible to every assertion here —
 * a member of A is never shown it, which is itself one of the shared suite's own
 * assertions (`lists only organizations the actor belongs to`) and is why
 * running the shared suite against a two-tenant world is worth more than
 * running it against a one-tenant one.
 *
 * `outsider` belongs to neither organization, which is what the suite's deps
 * require. It does hold an open invitation from B, addressed to it — issued by
 * the world for the security suite's benefit. That changes nothing here: an
 * invitation is not a membership, and the suite's own invitations are matched by
 * id.
 *
 * ## What this store cannot see
 *
 * `FakeDataSource` enforces no unique constraints (item 4 on its own inventory),
 * so `uq_memberships_org_user`, `uq_organizations_slug` and
 * `uq_organization_invitations_token_hash` are invisible to this run. Nothing
 * below should be read as covering one: the `AlreadyAMemberError` this suite
 * asserts is the sequential check inside `acceptInvitation`, never the
 * constraint behind it.
 */

runIOrganizationServiceContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  // Well-formed for this store — ids here are `fake-<Entity>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentOrganizationId: 'fake-OrganizationRecord-absent' as OrganizationId,
  absentInvitationId: 'fake-InvitationRecord-absent' as InvitationId,
  // A real opaque token, generated the way this backend generates one, and never
  // stored — so the lookup it fails is the same hash lookup a real value would
  // go through, not a rejection of something that never looked like a token.
  absentToken: generateOpaqueToken().token,
  makeContext: async () => {
    const world = await makeTenancyWorld();

    return {
      service: world.organizations,

      organization: world.orgA,
      owner: world.ownerA,
      admin: world.adminA,
      member: world.memberA,
      outsider: world.outsider,

      // Nobody's account and nobody's invitation in either organization. The
      // suite cannot invent one — an address it made up could collide with a
      // seeded account and fail the invitation assertions with
      // `ALREADY_A_MEMBER`, blaming the implementation for this world's choice
      // of fixtures.
      uninvitedEmail: 'nobody@example.test',
      tokenFor: world.tokenFor,
      now: world.now,
    };
  },
});
