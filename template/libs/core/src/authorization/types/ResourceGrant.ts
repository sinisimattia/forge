import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { UserId } from '../../users/types/UserId';
import type { GrantId } from './GrantId';
import type { Permission } from './Permission';
import type { ResourceType } from './ResourceType';

/**
 * One exception a role cannot express: this one person may do this one thing to
 * this one record.
 *
 * Layer three of the three ADR-0006 evaluates, and the only additive one — a
 * grant turns a refusal into a pass and never the reverse. Roles answer "what
 * may somebody of this kind do here"; a grant answers "what may this person do
 * to *that*", which is a question a role cannot be narrowed enough to answer
 * without becoming a role per record.
 *
 * **A grant names one organization and never widens past it** (ADR-0006). The
 * tenant is a field of the grant rather than something inferred from the record
 * it points at, because `can` has no lookup: given only a resource type and an
 * id it could not tell whose tenant the record is in, and two tenants are free
 * to issue the same id. Matching on the id alone would let a grant in one
 * organization answer for a record that happens to share an id in another,
 * which is the cross-tenant escalation this field exists to make impossible.
 */
export interface ResourceGrant {
  /** The grant's identifier. */
  id: GrantId;
  /** The person the grant is for. */
  subjectUserId: UserId;
  /**
   * The tenant the grant is confined to. A grant always names one — there is no
   * grant that spans the deployment, which is layer one's alone.
   */
  organizationId: OrganizationId;
  /** What kind of record it is about. */
  resourceType: ResourceType;
  /**
   * Which record, as that kind of record's store identifies it.
   *
   * An unbranded string, unlike every other identifier here: core does not know
   * what a deployment's records are, so it has no brand to give this and would
   * be inventing one per resource type it had been told about.
   */
  resourceId: string;
  /** The one thing the subject may do to it. */
  permission: Permission;
  /**
   * Who issued it, retained so that an exception has somebody accountable for
   * it — or `null` once that account has since been deleted. Every grant is
   * issued naming a real issuer ({@link IAuthorizationService.createGrant});
   * `null` arises only afterward, the same way `AuditEntryProps.actorId` and
   * `InvitationProps.invitedByUserId` do, and for the same reason: the grant
   * outlives the account that made it.
   */
  grantedBy: UserId | null;
  /** When it was issued. */
  createdAt: Date;
  /**
   * When it lapses, or `null` for a grant that does not.
   *
   * Read by {@link isGrantLive} and by nothing else — `can` never looks at it,
   * because reading it needs a clock and a clock would make `can` impure. The
   * hydrator applies the rule; see {@link Principal.grants}.
   */
  expiresAt: Date | null;
}
