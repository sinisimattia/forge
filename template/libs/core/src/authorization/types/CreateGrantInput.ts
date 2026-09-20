import type { UserId } from '../../users/types/UserId';
import type { Permission } from './Permission';
import type { ResourceType } from './ResourceType';

/**
 * What a caller must supply to issue a grant.
 *
 * Neither the organization nor the issuer appears here. The organization is a
 * parameter of the call, like every other organization-scoped method on
 * {@link IAuthorizationService}, and the issuer is the actor — taking either
 * from the input would let a caller name a tenant it is not acting in, or claim
 * somebody else issued the exception.
 */
export interface CreateGrantInput {
  /** The person the grant is for. They must already be a member of the organization. */
  subjectUserId: UserId;
  /** What kind of record it is about. */
  resourceType: ResourceType;
  /** Which record. */
  resourceId: string;
  /** The one thing the subject may do to it. */
  permission: Permission;
  /**
   * When it lapses. Omitted or `null` issues a grant that does not lapse, which
   * is a deliberate choice a caller has to make rather than the shape of a
   * forgotten field — an exception with no end is the kind that outlives the
   * reason for it.
   */
  expiresAt?: Date | null;
}
