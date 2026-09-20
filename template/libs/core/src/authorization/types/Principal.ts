import type { OrgRole } from '../../organizations/enums/OrgRole';
import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { PlatformRole } from '../../users/enums/PlatformRole';
import type { UserId } from '../../users/types/UserId';
import type { ResourceGrant } from './ResourceGrant';
import type { ResourceType } from './ResourceType';

/**
 * One organization a principal belongs to, and what they are in it.
 *
 * A role is a property of a membership and never of a person (spec §9.4), so
 * this pair is the smallest thing a decision can read. It is not a
 * {@link Membership}: that is a record with a lifecycle and an id, this is the
 * two facts a rule consults, and keeping them apart is what lets a caller
 * hydrate a principal without loading rows it will not read.
 */
export interface PrincipalMembership {
  /** Which organization. */
  organizationId: OrganizationId;
  /** What they are in it. */
  role: OrgRole;
}

/**
 * Everything an access decision is allowed to know about whoever is asking.
 *
 * It is the *whole* input, deliberately: `can` looks nothing up, so a caller
 * that has not established a fact cannot have that fact considered. Adding a
 * field here is adding something every caller must now hydrate before it may
 * ask a question — which is the cost ADR-0006 accepts in exchange for one
 * statement of the rules that both the server and its clients can evaluate.
 *
 * It is not a {@link User}. A user is a record with a lifecycle; a principal is
 * the subset of it a decision reads, and keeping them apart is what lets a
 * caller that holds only two fields ask a question at all.
 */
export interface Principal {
  /** Whose request this is. */
  userId: UserId;
  /** Their standing with respect to the deployment. */
  platformRole: PlatformRole;
  /**
   * Every organization this person belongs to, and their role in each.
   *
   * Required and not optional. A caller that has not hydrated them holds an
   * empty array, which means "belongs to nothing" — a refusal — rather than
   * "unknown", which a decision has no way to answer. Making the field optional
   * would let a forgotten hydration read as a deliberate answer.
   */
  memberships: readonly PrincipalMembership[];
  /**
   * The record-level exceptions this person holds, **live as of hydration**.
   *
   * That phrase is the whole contract of this field. `can` never reads
   * `expiresAt`: doing so needs a clock, and a clock would stop the same
   * principal and resource producing the same answer, which is exactly what
   * lets the server and a client evaluate the same rule. So the expiry rule is
   * {@link isGrantLive}, and applying it is the hydrator's job — a lapsed grant
   * must be absent from this array rather than present and ignored.
   *
   * Required and not optional, for the same reason `memberships` is and one
   * more. An optional list lets a hydrator that forgot the expiry rule omit the
   * field entirely, and `can` would read the absence as "holds no exceptions" —
   * a wrong answer that looks like a right one. Required makes forgetting it a
   * compile error, which is the only place the omission can still be caught.
   * A caller with nothing to hydrate passes an empty array, which says
   * "exercised the rule and found none".
   */
  grants: readonly ResourceGrant[];
}

/**
 * What a decision is about.
 *
 * Every field is optional because the layers ask different questions: layer two
 * asks which tenant the record belongs to, the ownership rule asks whose it is,
 * and a permission that is about neither passes no resource at all. An absent
 * field is "this record has no such property", never "do not check" — the
 * layers below read each absence as its own refusal.
 */
export interface Resource {
  /**
   * The tenant the record belongs to. Absent for a record outside every tenant,
   * which is not the same as a record whose tenant the caller did not hydrate:
   * `can` cannot tell those apart, so the caller must not conflate them.
   */
  organizationId?: OrganizationId;
  /** The person the record is about. Absent when it is about nobody in particular. */
  ownerId?: UserId;
  /**
   * What kind of record it is. Layer three asks it, and a caller that names one
   * of this and `resourceId` without the other has named no record — layer
   * three requires both, along with `organizationId`, before it consults a
   * grant at all.
   */
  resourceType?: ResourceType;
  /** Which record, as that kind of record's store identifies it. */
  resourceId?: string;
}
