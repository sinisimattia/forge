import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { OrganizationRecord } from './organization-record.entity';

/**
 * One row to one entity, in one place. See `to-user.ts` for why this is a
 * free function rather than a static on whichever service needed it first.
 *
 * The branded id is asserted here, in one visible line — `OrganizationRecord.id`
 * is a plain `string` deliberately (see `UserRecord`), so this is the boundary
 * where a stored value is claimed to belong to the organizations domain.
 *
 * It builds a real `Organization`, so every invariant the entity enforces
 * runs on every read: a row whose name is blank, or whose slug cannot be used
 * in a path, fails here rather than being handed on as something that looks
 * like an organization and is not.
 *
 * @param row - the stored row
 * @returns the same organization as a domain entity
 */
export function toOrganizationEntity(row: OrganizationRecord): Organization {
  return new Organization({
    id: row.id as OrganizationId,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
