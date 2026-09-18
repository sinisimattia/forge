import type { MigrationInterface, QueryRunner } from 'typeorm';
import { requireAppRoleName } from '../app-role';

/**
 * Takes `UPDATE` and `DELETE` on `audit_entries` away from the application
 * role, which is what makes the audit log append-only.
 *
 * A separate migration from the one that creates the table, so that the
 * guarantee appears in the migration list under its own name and a reviewer can
 * read it whole rather than finding it on line 180 of a schema migration. The
 * revert is a real revert: it hands both privileges back, which is the only
 * honest way to undo this, and the reason it is worth being able to see.
 *
 * What remains after this runs, confirmed by `has_table_privilege` as the
 * application role: `INSERT` and `SELECT` are `t`; `UPDATE`, `DELETE` and
 * `TRUNCATE` are `f`. `TRUNCATE` is `f` without being mentioned here — the
 * default privileges granted four privileges and `TRUNCATE` was never among
 * them — so revoking it would be a statement that does nothing, and the shorter
 * list is the one whose every line can be shown to matter.
 *
 * Neither is this the whole of it. Two things this `REVOKE` does *not* stop,
 * both closed elsewhere and both worth knowing about before someone reopens
 * them:
 *
 * - A foreign key's referential action runs with the *table owner's*
 *   privileges, not the caller's, so an `ON DELETE CASCADE` or `ON DELETE SET
 *   NULL` pointing at this table would let the application delete or rewrite an
 *   audit row through a statement aimed at another table entirely. Verified.
 *   `audit_entries` therefore carries no foreign key — see
 *   `IdentityFoundation1758000001000`.
 * - Nothing here restricts the *owner*. Migrations, `psql` as the superuser and
 *   a backup restore can all still change these rows. The guarantee is
 *   deliberately about the application: it is the thing that is exposed, runs
 *   arbitrary request-shaped code, and is the only one of the three that an
 *   attacker reaches through the product.
 *
 * This file is discriminating test D13's mechanism. The test itself is in Task
 * 19, against the running stack: nothing short of a real database can prove
 * that a real statement is refused.
 */
export class AuditAppendOnly1758000002000 implements MigrationInterface {
  name = 'AuditAppendOnly1758000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await exec(queryRunner, 'REVOKE UPDATE, DELETE ON audit_entries FROM %I', requireAppRoleName());
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await exec(queryRunner, 'GRANT UPDATE, DELETE ON audit_entries TO %I', requireAppRoleName());
  }
}

/**
 * Builds the statement with `format()` in the server and runs it.
 *
 * The role name cannot be a bind parameter — Postgres rejects one in a `GRANT`
 * or `REVOKE` the same way it rejects one in `CREATE ROLE` — so it has to
 * become part of the statement text, and `format('%I')` is the escaping the
 * parser itself agrees with.
 *
 * @param queryRunner - the migration's query runner
 * @param template - a `format()` template whose single `%I` is the role name
 * @param role - the application role, already validated by `requireAppRoleName`
 */
async function exec(queryRunner: QueryRunner, template: string, role: string): Promise<void> {
  const rendered: { sql: string }[] = await queryRunner.query(
    'SELECT format($1::text, $2::text) AS sql',
    [template, role],
  );
  await queryRunner.query(rendered[0].sql);
}
