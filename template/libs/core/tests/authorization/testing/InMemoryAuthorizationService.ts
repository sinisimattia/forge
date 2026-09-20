import type { IAuthorizationService } from '__FORGE_SCOPE__/core/authorization/contracts';
import {
  CrossTenantGrantError,
  GrantNotFoundError,
} from '__FORGE_SCOPE__/core/authorization/errors';
import type {
  CreateGrantInput,
  GrantId,
  GrantQuery,
  ResourceGrant,
  ResourceGrantJSON,
} from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

/** A grant as it comes back out of the store: instants as `Date`s again. */
function toGrant(row: ResourceGrantJSON): ResourceGrant {
  return {
    id: row.id,
    subjectUserId: row.subjectUserId,
    organizationId: row.organizationId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    permission: row.permission,
    grantedBy: row.grantedBy,
    createdAt: new Date(row.createdAt),
    expiresAt: row.expiresAt === null ? null : new Date(row.expiresAt),
  };
}

/**
 * A reference implementation over a Map of wire rows.
 *
 * It stores rows rather than grants on purpose: that is the shape a real
 * implementation has to map back on every read, so the suite is driven through
 * the same rehydration a real one performs.
 *
 * Writing it is also the cheapest possible proof that the contract is
 * implementable at all, and it is what lets each assertion that could most
 * easily have been written unfailable be watched failing, by breaking this in
 * the one way that assertion exists to catch.
 *
 * It enforces no authorization whatever: any actor may administer any grant in
 * an organization. Who may is `can`'s answer to `grant:read`, `grant:create`
 * and `grant:revoke`, and it is held to its own suite beside each real
 * implementation. The one thing this does enforce is the tenant boundary, which
 * is a property of the grant and not of the caller.
 */
export class InMemoryAuthorizationService implements IAuthorizationService {
  private readonly grants = new Map<string, ResourceGrantJSON>();
  /** `organizationId/userId` for every membership this world holds. */
  private readonly memberships = new Set<string>();
  private issued = 0;

  /** Puts somebody into an organization. */
  seedMembership(organizationId: OrganizationId, userId: UserId): void {
    this.memberships.add(`${organizationId}/${userId}`);
  }

  // `_actorId` because this reference implementation enforces no authorization:
  // who may read an organization's grants is `can`'s answer to `grant:read`,
  // asserted beside each real implementation.
  async listGrants(
    _actorId: UserId,
    organizationId: OrganizationId,
    query: GrantQuery,
  ): Promise<PaginatedResult<ResourceGrant>> {
    const mine = [...this.grants.values()]
      .filter((row) => row.organizationId === organizationId);
    const from = (query.page - 1) * query.limit;
    return {
      data: mine.slice(from, from + query.limit).map(toGrant),
      meta: {
        total: mine.length,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(mine.length / query.limit),
      },
    };
  }

  async createGrant(
    actorId: UserId,
    organizationId: OrganizationId,
    input: CreateGrantInput,
  ): Promise<ResourceGrant> {
    if (!this.memberships.has(`${organizationId}/${input.subjectUserId}`)) {
      throw new CrossTenantGrantError(organizationId, input.subjectUserId);
    }
    this.issued += 1;
    // `grantedBy` is `UserId | null` on the type, but `actorId` here is always
    // a real, present id: `null` is what a later read may answer once the
    // issuer's account has been deleted, which this reference store has no
    // operation that models — nothing here ever nulls out an existing grant's
    // issuer.
    const row: ResourceGrantJSON = {
      id: `grant-${this.issued}` as GrantId,
      subjectUserId: input.subjectUserId,
      organizationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      permission: input.permission,
      grantedBy: actorId,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt?.toISOString() ?? null,
    };
    this.grants.set(row.id, row);
    return toGrant(row);
  }

  // `_actorId` for the same reason as `listGrants`.
  async revokeGrant(
    _actorId: UserId,
    organizationId: OrganizationId,
    grantId: GrantId,
  ): Promise<void> {
    const row = this.grants.get(grantId);
    // The same answer for an id nobody issued and for one belonging to another
    // organization, which is the contract: telling them apart would confirm the
    // id exists to somebody who may not see it.
    if (row === undefined || row.organizationId !== organizationId) {
      throw new GrantNotFoundError(grantId);
    }
    this.grants.delete(grantId);
  }
}
