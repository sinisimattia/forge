import type { UserId } from '../../users/types/UserId';
import type { OrgRole } from '../enums/OrgRole';
import type { MembershipId } from './MembershipId';
import type { OrganizationId } from './OrganizationId';

/**
 * The wire shape of a {@link Membership}: the same six facts, with every
 * instant as an ISO-8601 string, because a serialized payload has no `Date`.
 */
export interface MembershipJSON {
  /** The membership's identifier. */
  id: MembershipId;
  /** The organization this membership belongs to. */
  organizationId: OrganizationId;
  /** The user this membership belongs to. */
  userId: UserId;
  /** What the user may do inside this organization. */
  role: OrgRole;
  /** When the membership came into being. */
  createdAt: string;
  /** When the membership was last changed. */
  updatedAt: string;
}
