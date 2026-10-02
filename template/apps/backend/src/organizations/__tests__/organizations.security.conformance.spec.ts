import { runIOrganizationServiceSecurityContract } from '__FORGE_SCOPE__/core/organizations/testing';
import type { InvitationId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { adaptJestToConformanceExpect, makeTenancyWorld } from '../../common/testing';

/**
 * `OrganizationsService` against core's **backend-only** tenant-isolation suite
 * — D9.
 *
 * ## DEC-1: the webapp does not drive this suite, and must not be made to
 *
 * The same split `auth.security.conformance.spec.ts` states for account states,
 * applied to tenants. The shared suite next door is driven by this backend under
 * jest and by the webapp under vitest, because behaviour both implementations
 * genuinely share is worth checking on both. This one is driven here and nowhere
 * else.
 *
 * Tenant isolation is a property of a *server*. The webapp's
 * `IOrganizationService` is an HTTP client exercised against a stub of this
 * backend's wire shape, so a webapp "proof" that a member of one organization
 * cannot read another's would be proving that a stub somebody wrote returns what
 * they told it to return — and it would be a *green* proof, which is worse than
 * none, because the asymmetry between the two drivers then looks like an
 * oversight somebody will helpfully correct. **The missing webapp driver is the
 * design.**
 *
 * ## The fault these assertions are written against
 *
 * The suite's own preamble names it, and it is worth repeating where the
 * implementation is, because it is not the fault this project first went looking
 * for. Hydrating the principal from the route's organization rather than the
 * credential's subject — the rule `PermissionsGuard` asserts — is a
 * real rule and a *fail-closed* one: looking a user up by an organization's id
 * finds nobody and refuses everything.
 *
 * The fault that could actually leak is the other one. `PermissionsGuard` passes
 * correctly for the organization the route names, and then a service resolves
 * its target row — an invitation, a membership — by that row's own id, with no
 * `organization_id` in the predicate. Nothing fails closed; the caller reaches
 * straight into the other tenant. The write-side assertions in this suite are
 * written against exactly that shape: a legitimate OWNER of A, acting inside A,
 * naming a row of B.
 *
 * ## What this store cannot see
 *
 * `FakeDataSource` enforces no unique constraints (item 4 on its own inventory).
 * `uq_memberships_org_user`, `uq_organizations_slug` and
 * `uq_organization_invitations_token_hash` do not exist for this run, so no
 * assertion below covers one. What is asserted here is the predicate the
 * implementation *asks for* — which is the half a unit test can own. The
 * statements that create those constraints are asserted in
 * `db/__tests__/migration-sql.spec.ts`; executing them against a real database,
 * which is the only thing that shows a constraint actually bites, is not done
 * anywhere in this repository.
 */

runIOrganizationServiceSecurityContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  // Well-formed for this store — ids here are `fake-<Entity>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentOrganizationId: 'fake-OrganizationRecord-absent' as OrganizationId,
  absentInvitationId: 'fake-InvitationRecord-absent' as InvitationId,
  makeContext: async () => {
    const world = await makeTenancyWorld();

    return {
      service: world.organizations,

      organization: world.orgA,
      owner: world.ownerA,
      member: world.memberA,

      otherOrganization: world.orgB,
      otherOwner: world.ownerB,
      otherMember: world.memberB,

      otherInvitation: world.invitationFromB,
      otherInvitationToken: world.tokenFromB,
      outsider: world.outsider,

      now: world.now,
    };
  },
});
