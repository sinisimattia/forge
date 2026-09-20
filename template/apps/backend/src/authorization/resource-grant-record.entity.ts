import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { Permission, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';

/**
 * The `resource_grants` row — one exception a role cannot express: this one
 * person may do this one thing to this one record (ADR-0006's layer three).
 *
 * See `UserRecord` for the conventions every record class in this backend
 * follows.
 */
@Entity('resource_grants')
@Index('ix_resource_grants_subject', ['subjectUserId', 'organizationId'])
export class ResourceGrantRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The tenant the grant is confined to. Always present — there is no grant
   * that spans the deployment, which is layer one's alone.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** The person the grant is for. */
  @Column({ name: 'subject_user_id', type: 'uuid' })
  subjectUserId!: string;

  /**
   * What kind of record it is about. Typed as core's branded `ResourceType`
   * even though the column is `text` — it is the deployment's own noun, never
   * enumerated by core, so there is no closed set a `CHECK` could express here.
   */
  @Column({ name: 'resource_type', type: 'text' })
  resourceType!: ResourceType;

  /** Which record, as that kind of record's store identifies it. */
  @Column({ name: 'resource_id', type: 'text' })
  resourceId!: string;

  /**
   * The one thing the subject may do to it. Typed as core's `Permission`
   * union even though the column is `text`, for the reason `UserRecord.status`
   * gives — `Permission` is written and reviewed in one file, and a `CHECK`
   * here would cost nothing today, but every enum-shaped column in this schema
   * is treated uniformly rather than judged one at a time.
   */
  @Column({ name: 'permission', type: 'text' })
  permission!: Permission;

  /**
   * Who issued it, or `null` when that account has since been deleted
   * (`ON DELETE SET NULL`, so the grant outlives the account that made it).
   */
  @Column({ name: 'granted_by', type: 'uuid', nullable: true })
  grantedBy!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** When it lapses, or `null` for a grant that does not. */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
