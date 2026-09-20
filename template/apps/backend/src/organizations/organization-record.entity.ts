import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * The `organizations` row, as TypeORM sees it.
 *
 * Named `OrganizationRecord` rather than `Organization` for the reason
 * `UserRecord` gives: `__FORGE_SCOPE__/core` already exports `Organization` —
 * the domain entity, which enforces the invariants and has no idea a database
 * exists — and a mapper that imports both in one file would otherwise need an
 * alias, chosen differently every time it was written.
 *
 * See `UserRecord` for the conventions every record class in this backend
 * follows: the table name and every column name are explicit, ids are plain
 * `string`, instants are `Date`.
 */
@Entity('organizations')
@Unique('uq_organizations_slug', ['slug'])
export class OrganizationRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The name shown to its members, stored trimmed. */
  @Column({ name: 'name', type: 'text' })
  name!: string;

  /** The path segment identifying the organization. Unique. */
  @Column({ name: 'slug', type: 'text' })
  slug!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Set by a soft delete. The row is retained; the organization is unusable. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
