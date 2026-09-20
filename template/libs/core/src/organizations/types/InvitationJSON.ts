import type { UserId } from '../../users/types/UserId';
import type { InvitationStatus } from '../enums/InvitationStatus';
import type { OrgRole } from '../enums/OrgRole';
import type { InvitationId } from './InvitationId';
import type { OrganizationId } from './OrganizationId';

/**
 * The wire shape of an {@link Invitation}: the same ten facts, with every
 * instant as an ISO-8601 string, because a serialized payload has no `Date`.
 */
export interface InvitationJSON {
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
  /** The member who sent the invitation, or `null` once that account has since been deleted. */
  invitedByUserId: UserId | null;
  /** The instant after which the invitation is no longer open, regardless of status. */
  expiresAt: string;
  /** When the invitation came into being. */
  createdAt: string;
  /** When the invitation was accepted, or `null` if it has not been. */
  acceptedAt: string | null;
  /** Who accepted the invitation, or `null` if it has not been accepted. */
  acceptedByUserId: UserId | null;
}
