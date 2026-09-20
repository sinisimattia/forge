import type { UserId } from '../../users/types/UserId';
import type { OrgRole } from '../enums/OrgRole';
import type { MembershipId } from './MembershipId';
import type { OrganizationId } from './OrganizationId';

/**
 * Everything needed to construct a {@link Membership}.
 *
 * A named object rather than positional parameters, for the same reason as
 * {@link OrganizationProps}: two of these fields are ids of different entities,
 * and a positional constructor makes a silent transposition possible that no
 * compiler can catch.
 */
export interface MembershipProps {
  /** The membership's identifier. */
  id: MembershipId;
  /** The organization this membership belongs to. */
  organizationId: OrganizationId;
  /** The user this membership belongs to. */
  userId: UserId;
  /** What the user may do inside this organization. */
  role: OrgRole;
  /** When the membership came into being. */
  createdAt: Date;
  /** When the membership was last changed. */
  updatedAt: Date;
}
