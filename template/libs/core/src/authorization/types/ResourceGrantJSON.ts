import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { UserId } from '../../users/types/UserId';
import type { GrantId } from './GrantId';
import type { Permission } from './Permission';
import type { ResourceType } from './ResourceType';

/**
 * The wire shape of a {@link ResourceGrant}: the same nine facts, with every
 * instant as an ISO-8601 string, because a serialized payload has no `Date`.
 */
export interface ResourceGrantJSON {
  /** The grant's identifier. */
  id: GrantId;
  /** The person the grant is for. */
  subjectUserId: UserId;
  /** The tenant the grant is confined to. */
  organizationId: OrganizationId;
  /** What kind of record it is about. */
  resourceType: ResourceType;
  /** Which record. */
  resourceId: string;
  /** The one thing the subject may do to it. */
  permission: Permission;
  /** Who issued it, or `null` once that account has since been deleted. */
  grantedBy: UserId | null;
  /** When it was issued. */
  createdAt: string;
  /** When it lapses, or `null` for a grant that does not. */
  expiresAt: string | null;
}
