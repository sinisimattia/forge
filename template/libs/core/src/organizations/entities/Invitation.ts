import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import { EmailRequiredError } from '../../users/errors/EmailRequiredError';
import type { UserId } from '../../users/types/UserId';
import { InvitationStatus } from '../enums/InvitationStatus';
import type { OrgRole } from '../enums/OrgRole';
import type { InvitationId } from '../types/InvitationId';
import type { InvitationJSON } from '../types/InvitationJSON';
import type { InvitationProps } from '../types/InvitationProps';
import type { OrganizationId } from '../types/OrganizationId';

/**
 * An email-based, single-use, expiring offer of a role in an organization
 * (spec §9.4). Accepting one while signed out routes through registration and
 * then consumes the invitation — the invitation itself does not care which
 * order that happened in, only that the account which accepts holds the
 * address it was sent to.
 */
export class Invitation {
  readonly id: InvitationId;
  /** The organization the invitation offers membership in. */
  readonly organizationId: OrganizationId;
  /** Normal form, per `normalizeEmail`. The address the offer is addressed to. */
  readonly email: string;
  /** The role the invitation offers, once accepted. */
  readonly role: OrgRole;
  /** Where the invitation stands, as a fact somebody recorded. See {@link InvitationStatus}. */
  readonly status: InvitationStatus;
  /** The member who sent the invitation. */
  readonly invitedByUserId: UserId;
  /** The instant after which the invitation is no longer open, regardless of status. */
  readonly expiresAt: Date;
  /** When the invitation came into being. */
  readonly createdAt: Date;
  /** When the invitation was accepted, or `null` if it has not been. */
  readonly acceptedAt: Date | null;
  /** Who accepted the invitation, or `null` if it has not been accepted. */
  readonly acceptedByUserId: UserId | null;

  /**
   * @param props - the ten facts that make up an invitation
   * @throws EmailRequiredError when the address is absent or only whitespace
   */
  constructor(props: InvitationProps) {
    const email = normalizeEmail(props.email);
    if (email === '') throw new EmailRequiredError();

    this.id = props.id;
    this.organizationId = props.organizationId;
    this.email = email;
    this.role = props.role;
    this.status = props.status;
    this.invitedByUserId = props.invitedByUserId;
    this.expiresAt = props.expiresAt;
    this.createdAt = props.createdAt;
    this.acceptedAt = props.acceptedAt;
    this.acceptedByUserId = props.acceptedByUserId;
  }

  /**
   * Whether this invitation has lapsed as of `now`.
   *
   * The instant is a parameter and not `new Date()`, which is the same rule
   * `isOpenAt` follows and for the same reason: an entity that reads a clock
   * returns a different answer for the same inputs, so nothing about it can be
   * asserted without controlling time. `expiresAt` is the first instant at
   * which it is expired, not the last at which it is open.
   */
  isExpiredAt(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  /**
   * Whether this invitation may still be accepted as of `now`: still PENDING
   * and not yet expired.
   *
   * This is the one question every caller actually has, and it answers both
   * halves at once — see {@link InvitationStatus} for why expiry is not a
   * status this could switch on instead.
   */
  isOpenAt(now: Date): boolean {
    return this.status === InvitationStatus.PENDING && !this.isExpiredAt(now);
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): InvitationJSON {
    return {
      id: this.id,
      organizationId: this.organizationId,
      email: this.email,
      role: this.role,
      status: this.status,
      invitedByUserId: this.invitedByUserId,
      expiresAt: this.expiresAt.toISOString(),
      createdAt: this.createdAt.toISOString(),
      acceptedAt: this.acceptedAt?.toISOString() ?? null,
      acceptedByUserId: this.acceptedByUserId,
    };
  }

  /**
   * Rebuilds an invitation from its wire shape, re-running every invariant.
   *
   * @param json - an invitation as it crosses a serialization boundary
   * @returns the same invitation as a real entity, instants revived
   */
  static fromJSON(json: InvitationJSON): Invitation {
    return new Invitation({
      id: json.id,
      organizationId: json.organizationId,
      email: json.email,
      role: json.role,
      status: json.status,
      invitedByUserId: json.invitedByUserId,
      expiresAt: new Date(json.expiresAt),
      createdAt: new Date(json.createdAt),
      acceptedAt: json.acceptedAt === null ? null : new Date(json.acceptedAt),
      acceptedByUserId: json.acceptedByUserId,
    });
  }
}
