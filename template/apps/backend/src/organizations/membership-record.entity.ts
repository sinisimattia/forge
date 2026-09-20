import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';

/**
 * The `memberships` row — one person, one organization, one role.
 *
 * See `UserRecord` for the conventions every record class in this backend
 * follows.
 */
@Entity('memberships')
// `uq_memberships_org_user` is the database's half of "a person is a member
// of an organization at most once". The migration is the schema's authority
// — `synchronize` is off and nothing here creates anything — this mirrors it
// so the rule is visible from the class a reader has open, the same reason
// `AuthIdentityRecord` mirrors `uq_auth_identities_provider_account`.
@Unique('uq_memberships_org_user', ['organizationId', 'userId'])
export class MembershipRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The organization this membership belongs to. */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** The user this membership belongs to. */
  @Index('ix_memberships_user')
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /**
   * Typed as core's enum even though the column is `text`, for the reason
   * `UserRecord.status` gives: `OrgRole` is a small, closed set and a `CHECK`
   * would cost nothing, but every enum column in this schema is treated the
   * same way — the database does not enforce it, and a row written by
   * anything other than this application can hold a value no `OrgRole`
   * member matches.
   */
  @Column({ name: 'role', type: 'text' })
  role!: OrgRole;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
