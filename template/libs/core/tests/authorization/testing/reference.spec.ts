import type { AuthorizationServiceContractContext } from '__FORGE_SCOPE__/core/authorization/testing';
import { runIAuthorizationServiceContract } from '__FORGE_SCOPE__/core/authorization/testing';
import type { GrantId, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';
import { InMemoryAuthorizationService } from './InMemoryAuthorizationService';

const ACME = 'org-acme' as OrganizationId;
const BOREALIS = 'org-borealis' as OrganizationId;

const ADA = 'user-ada' as UserId;
const GRACE = 'user-grace' as UserId;
const KATHERINE = 'user-katherine' as UserId;

/**
 * A fresh world: two organizations, holding no grant at all.
 *
 * `ADA` administers both and `GRACE` belongs to both, which is what lets a
 * grant be issued on either side of the boundary the suite is about.
 * `KATHERINE` belongs to `BOREALIS` and to nothing else — somebody who exists
 * and belongs somewhere, and still may not be granted anything in `ACME`.
 */
async function makeContext(): Promise<AuthorizationServiceContractContext> {
  const service = new InMemoryAuthorizationService();
  service.seedMembership(ACME, ADA);
  service.seedMembership(BOREALIS, ADA);
  service.seedMembership(ACME, GRACE);
  service.seedMembership(BOREALIS, GRACE);
  service.seedMembership(BOREALIS, KATHERINE);

  return {
    service,
    organizationId: ACME,
    otherOrganizationId: BOREALIS,
    actorId: ADA,
    subjectUserId: GRACE,
    outsiderId: KATHERINE,
    // This store recognizes any noun, so the suite's own is as good as any.
    resourceType: 'document' as ResourceType,
    now: new Date(),
  };
}

runIAuthorizationServiceContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
  // Well-formed for this store — its keys are plain strings — and in no world.
  absentGrantId: 'no-such-grant' as GrantId,
});
