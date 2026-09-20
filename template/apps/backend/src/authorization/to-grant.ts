import type { GrantId, ResourceGrant } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { ResourceGrantRecord } from './resource-grant-record.entity';

/**
 * One row to one entity, in one place. See `to-user.ts` for why this is a
 * free function rather than a static on whichever service needed it first.
 *
 * Unlike `toOrganizationEntity` or `toMembershipEntity`, this does not
 * construct a class: `ResourceGrant` is a plain interface, not a domain
 * entity with a constructor — layer three's rules live in `can` and
 * `isGrantLive`, not on the grant itself, so there is no invariant here to
 * run. What this function still is is the one boundary where every branded id
 * on the row is claimed for its domain, in one visible place, exactly as the
 * mappers that do build an entity do.
 *
 * `grantedBy` is cast to `UserId | null`, matching `ResourceGrantRecord`'s
 * nullable column (`ON DELETE SET NULL`, so a grant outlives the account that
 * issued it) and core's `ResourceGrant.grantedBy` field of the same type.
 *
 * @param row - the stored row
 * @returns the same grant, its ids and types claimed for their domains
 */
export function toGrantEntity(row: ResourceGrantRecord): ResourceGrant {
  return {
    id: row.id as GrantId,
    subjectUserId: row.subjectUserId as UserId,
    organizationId: row.organizationId as OrganizationId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    permission: row.permission,
    grantedBy: row.grantedBy as UserId | null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
