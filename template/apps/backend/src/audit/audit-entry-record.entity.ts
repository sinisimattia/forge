import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';

/**
 * The `audit_entries` row — one thing that happened, recorded so it can be
 * reconstructed later.
 *
 * This table is append-only *to this application*, and the mechanism is not in
 * this file: `AuditAppendOnly1758000002000` revokes `UPDATE` and `DELETE` on it
 * from the role the application connects as, so the database refuses the
 * statement rather than trusting nobody writes it. Two things follow that are
 * easy to get wrong from here:
 *
 * - **Do not add a `@ManyToOne` to `UserRecord` or `OrganizationRecord`.**
 *   TypeORM would create a foreign key, and a foreign key's referential action
 *   runs with the table owner's privileges rather than the caller's — an
 *   `ON DELETE CASCADE` or `SET NULL` would hand the application a way to
 *   delete or rewrite an audit row through a statement aimed at `users` or
 *   `organizations`. `actorUserId` and `organizationId` are bare columns for
 *   that reason, and either may name a row that no longer exists.
 * - **Do not update a row through this class.** The database will refuse it;
 *   the point of saying so here is that the refusal arrives at runtime, in
 *   whatever request was unlucky, rather than at review.
 *
 * See `UserRecord` for the conventions every record class follows.
 */
@Entity('audit_entries')
export class AuditEntryRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The tenant it happened in, or `null` when it belonged to none.
   *
   * `uuid` since `OrganizationsAndAuthorization1758000003000`. It shipped as
   * `text` originally because no organization table existed yet and core had
   * no `OrganizationId` to brand it with; the column was added that early
   * rather than later precisely because this table is append-only, and adding
   * a column later would mean backfilling rows the application is not
   * permitted to update (ADR-0007). The organizations-and-authorization
   * migration widens the type with `USING organization_id::uuid`, verified
   * safe because nothing had ever written a non-null value into it.
   *
   * **Still no foreign key to `organizations`, on purpose — see
   * `OrganizationsAndAuthorization1758000003000`'s own TSDoc and
   * `AuditEntryRecord`'s class doc below.** A `uuid` column that names a table
   * which now exists is exactly the moment a foreign key looks like finishing
   * the job rather than breaking it; ADR-0009 and discriminating test D13 are
   * why it stays absent.
   */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId!: string | null;

  /**
   * Who acted, or `null` when nobody was identified.
   *
   * Nullable because the entries most worth having are the ones nobody was
   * signed in for: a failed sign-in has no actor by definition.
   */
  @Index('ix_audit_entries_actor_user_id')
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId!: string | null;

  /**
   * What happened. `text`, with no `CHECK` and no Postgres `enum` type — and
   * this is the column that makes that the rule for the whole schema.
   *
   * `AuditAction` gains members every phase, and this table is append-only: a
   * constrained domain would mean a schema migration for each new member, on
   * the one table whose existing rows nothing is permitted to correct if the
   * migration is got wrong. `UserStatus` and `PlatformRole` would each take a
   * `CHECK` happily; they follow this column instead, for the reason set out on
   * `UserRecord.status`.
   */
  @Column({ name: 'action', type: 'text' })
  action!: AuditAction;

  /** What kind of thing it happened to, or `null` when it was not about a thing. */
  @Column({ name: 'resource_type', type: 'text', nullable: true })
  resourceType!: string | null;

  @Column({ name: 'resource_id', type: 'text', nullable: true })
  resourceId!: string | null;

  /**
   * Whatever else is worth reconstructing later. **Never anything secret** —
   * this is the most-read table in an incident and the least-protected in a
   * backup, and a row written here is one nothing is permitted to correct.
   */
  @Column({ name: 'metadata', type: 'jsonb' })
  metadata!: Record<string, unknown>;

  /** The network address the action came from, as the application saw it. */
  @Column({ name: 'client_address', type: 'text', nullable: true })
  clientAddress!: string | null;

  @Column({ name: 'client_label', type: 'text', nullable: true })
  clientLabel!: string | null;

  @Index('ix_audit_entries_occurred_at')
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
}
