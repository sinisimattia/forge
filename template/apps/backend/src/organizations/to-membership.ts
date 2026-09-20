import { Membership } from '__FORGE_SCOPE__/core/organizations/entities';
import type { MembershipId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { MembershipRecord } from './membership-record.entity';

/**
 * One row to one entity, in one place. See `to-user.ts` for why this is a
 * free function rather than a static on whichever service needed it first.
 *
 * Two branded ids are asserted here, in two visible lines — `organizationId`
 * and `userId`, each claimed to belong to its own domain at this one boundary,
 * the only one.
 *
 * @param row - the stored row
 * @returns the same membership as a domain entity
 */
export function toMembershipEntity(row: MembershipRecord): Membership {
  return new Membership({
    id: row.id as MembershipId,
    organizationId: row.organizationId as OrganizationId,
    userId: row.userId as UserId,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
