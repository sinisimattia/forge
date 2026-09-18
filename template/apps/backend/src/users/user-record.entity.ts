import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';

/**
 * The `users` row, as TypeORM sees it.
 *
 * Named `UserRecord` rather than `User` because `__FORGE_SCOPE__/core` already
 * exports a `User` — the domain entity, which enforces the invariants and has
 * no idea a database exists. A repository maps between the two and imports
 * both, so identical names would force an alias in every such file and the
 * alias would be chosen differently each time. The distinction is worth
 * keeping sharp anyway: this class is the shape of a row, not the shape of a
 * person, and it is allowed to hold values the domain entity would refuse.
 *
 * Conventions every record class in this backend follows, stated once here:
 *
 * - **The table name is explicit.** `@Entity('users')`, never `@Entity()`. A
 *   class rename is a refactor; a table rename is a migration. Naming the table
 *   means the first can never silently become the second.
 * - **Every column name is explicit**, for the same reason, and because
 *   TypeORM's default naming strategy would produce `displayName` — the column
 *   the migrations create is `display_name`, and the migrations are the
 *   authority on that.
 * - **Ids are plain `string`.** Core's `UserId` is a branded type: a claim
 *   about which domain the value belongs to, which the mapper is the right
 *   place to make, in one visible line, rather than an assertion hidden in a
 *   decorator. An enum column is different — see `status` below.
 * - **Instants are `Date`**, from `timestamptz`. The database stores the
 *   instant, not the offset it was written in.
 */
@Entity('users')
export class UserRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Normal form only — trimmed and lowercased, per core's `normalizeEmail`. Unique. */
  @Column({ name: 'email', type: 'text' })
  email!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  /**
   * Typed as core's enum even though the column is `text`.
   *
   * Unlike an id's brand, this is a statement about the column's own contents —
   * the set of values it may hold is a domain fact, and a reader of this class
   * wants it next to the column type.
   *
   * **The database does not enforce it, and for this column that is a judgment
   * call rather than an obvious one.** `UserStatus` and `PlatformRole` are two
   * small, closed sets; a `CHECK` on them would cost nothing today and would
   * catch a typo no compiler can. It is not here because every enum column in
   * this schema is treated the same way, and the columns that make the rule are
   * the ones whose sets grow — see `AuditEntryRecord.action`. What that
   * uniformity costs is exactly the typo: a row written by anything other than
   * this application, a repair script or a restore, can put a value in here
   * that no `UserStatus` member matches, and nothing will refuse it.
   *
   * The reason it is uniformity rather than a per-column judgment: this is a
   * project template, so the enums are *other people's* to extend, and a
   * `CHECK` makes each member they add a schema migration in their project.
   * That is friction aimed at the wrong party. A generated project that wants
   * the constraint should add it — for these two columns it is a good idea.
   */
  @Column({ name: 'status', type: 'text' })
  status!: UserStatus;

  @Column({ name: 'platform_role', type: 'text' })
  platformRole!: PlatformRole;

  /** When the address was proven, or `null` if it has not been. */
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Set by a soft delete. The row is retained; the account is unusable. */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
