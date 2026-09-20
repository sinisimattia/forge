import type { UserId } from '../../users/types/UserId';
import { OrgRole } from '../enums/OrgRole';
import type { MembershipId } from '../types/MembershipId';
import type { MembershipJSON } from '../types/MembershipJSON';
import type { MembershipProps } from '../types/MembershipProps';
import type { OrganizationId } from '../types/OrganizationId';

/**
 * Binds one person to one organization with one role.
 *
 * It enforces no invariant of its own, and that is not an omission. Every rule
 * about memberships is a rule about a *set* of them — an organization always
 * has at least one OWNER, a person is a member of an organization at most once
 * — and a single entity cannot see the set it belongs to. Those rules live in
 * `IOrganizationService`'s contract and are asserted by its conformance suite,
 * where the world that makes them checkable exists.
 */
export class Membership {
  readonly id: MembershipId;
  /** The organization this membership belongs to. */
  readonly organizationId: OrganizationId;
  /** The user this membership belongs to. */
  readonly userId: UserId;
  /** What the user may do inside this organization. */
  readonly role: OrgRole;
  /** When the membership came into being. */
  readonly createdAt: Date;
  /** When the membership was last changed. */
  readonly updatedAt: Date;

  /** @param props - the six facts that make up a membership */
  constructor(props: MembershipProps) {
    this.id = props.id;
    this.organizationId = props.organizationId;
    this.userId = props.userId;
    this.role = props.role;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  /** Whether this membership carries the OWNER role. */
  get isOwner(): boolean {
    return this.role === OrgRole.OWNER;
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): MembershipJSON {
    return {
      id: this.id,
      organizationId: this.organizationId,
      userId: this.userId,
      role: this.role,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Rebuilds a membership from its wire shape.
   *
   * @param json - a membership as it crosses a serialization boundary
   * @returns the same membership as a real entity, instants revived
   */
  static fromJSON(json: MembershipJSON): Membership {
    return new Membership({
      id: json.id,
      organizationId: json.organizationId,
      userId: json.userId,
      role: json.role,
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
    });
  }
}
