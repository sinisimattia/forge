import type { UserId } from '../../users/types/UserId';
import type { InvitationStatus } from '../enums/InvitationStatus';
import type { OrgRole } from '../enums/OrgRole';
import type { InvitationId } from './InvitationId';
import type { OrganizationId } from './OrganizationId';

/**
 * Everything needed to construct an {@link Invitation}.
 *
 * A named object rather than positional parameters, for the same reason as
 * {@link OrganizationProps}: several of these fields are ids of different
 * entities and two are adjacent instants, and a positional constructor makes a
 * silent transposition possible that no compiler can catch.
 */
export interface InvitationProps {
  /** The invitation's identifier. */
  id: InvitationId;
  /** The organization the invitation offers membership in. */
  organizationId: OrganizationId;
  /** The address the invitation is addressed to. */
  email: string;
  /** The role the invitation offers, once accepted. */
  role: OrgRole;
  /** Where the invitation stands, as a fact somebody recorded. */
  status: InvitationStatus;
  /**
   * The member who sent the invitation, or `null` once that account has since
   * been deleted. The invitation outlives the account that made it — the same
   * rule `acceptedByUserId` already follows, and `AuditEntryProps.actorId`
   * before it: a column that names an account may end up naming nobody, and a
   * reader treats that as expected rather than as corruption.
   */
  invitedByUserId: UserId | null;
  /** The instant after which the invitation is no longer open, regardless of status. */
  expiresAt: Date;
  /** When the invitation came into being. */
  createdAt: Date;
  /** When the invitation was accepted, or `null` if it has not been. */
  acceptedAt: Date | null;
  /** Who accepted the invitation, or `null` if it has not been accepted. */
  acceptedByUserId: UserId | null;
}
