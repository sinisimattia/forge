import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';

/**
 * The `organization_invitations` row — an email-based, single-use, expiring
 * offer of a role in an organization.
 *
 * `tokenHash` has **no mapper field**. `__FORGE_SCOPE__/core`'s `Invitation`
 * has no token and no hash on it — the entity models the offer, never the
 * secret that redeems it — which is what makes it structurally impossible for
 * a serialized invitation to carry one: there is no field on the entity to
 * put it in. The same fact `IdentityFoundation1758000001000` states for
 * `email_verification_tokens` and `password_reset_tokens`, and the same
 * `COMMENT ON COLUMN` this migration's `token_hash` carries into the database
 * itself.
 *
 * See `UserRecord` for the conventions every record class in this backend
 * follows.
 */
@Entity('organization_invitations')
@Unique('uq_organization_invitations_token_hash', ['tokenHash'])
export class InvitationRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The organization the invitation offers membership in. */
  @Index('ix_organization_invitations_org')
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** Normal form only — trimmed and lowercased, per core's `normalizeEmail`. */
  @Column({ name: 'email', type: 'text' })
  email!: string;

  /**
   * Typed as core's enum even though the column is `text`, for the reason
   * `UserRecord.status` gives.
   */
  @Column({ name: 'role', type: 'text' })
  role!: OrgRole;

  /**
   * Typed as core's enum even though the column is `text`, for the reason
   * `UserRecord.status` gives. Never `EXPIRED` — see `InvitationStatus` for
   * why expiry is a function of `expiresAt` and the instant you ask rather
   * than a fourth status value.
   */
  @Column({ name: 'status', type: 'text' })
  status!: InvitationStatus;

  /** A hash of the single-use token, never the token. See this class's own TSDoc. */
  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  /**
   * The member who sent the invitation, or `null` when that account has since
   * been deleted (`ON DELETE SET NULL`, so the offer outlives the account that
   * made it).
   */
  @Column({ name: 'invited_by_user_id', type: 'uuid', nullable: true })
  invitedByUserId!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** When the invitation was accepted, or `null` if it has not been. */
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  /**
   * Who accepted the invitation, or `null` if it has not been accepted — or if
   * the account that accepted it has since been deleted (`ON DELETE SET
   * NULL`).
   */
  @Column({ name: 'accepted_by_user_id', type: 'uuid', nullable: true })
  acceptedByUserId!: string | null;
}
