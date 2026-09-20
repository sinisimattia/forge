import type { OrgRole } from '../../organizations/enums/OrgRole';
import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { PlatformRole } from '../../users/enums/PlatformRole';
import type { UserId } from '../../users/types/UserId';

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
}
