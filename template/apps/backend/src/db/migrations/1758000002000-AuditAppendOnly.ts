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
 * Neither is this the whole of it. Three things this `REVOKE` does *not* stop,
 * all closed elsewhere and all worth knowing about before someone reopens
 * them:
 *
 * - A foreign key's referential action runs with the *table owner's*
 *   privileges, not the caller's, so an `ON DELETE CASCADE` or `ON DELETE SET
 *   NULL` pointing at this table would let the application delete or rewrite an
 *   audit row through a statement aimed at another table entirely. Verified.
 *   `audit_entries` therefore carries no foreign key — see
 *   `IdentityFoundation1758000001000` — and that holds however the key is
 *   written: inside the `CREATE TABLE`, by a later `ALTER TABLE … ADD
 *   CONSTRAINT`, or by a `@ManyToOne` on `AuditEntryRecord` that
 *   `migration:generate` then emits for you.
 * - **A later migration that re-creates this table gets the privileges back.**
 *   `ALTER DEFAULT PRIVILEGES` is standing configuration, not a one-time act:
 *   everything the owner creates in `public` from now on carries `arwd` for the
 *   application role. Verified — drop and re-create `audit_entries` as the
 *   owner and `relacl` reads `"…-app"=arwd/owner` again, with `UPDATE` and
 *   `DELETE` working. This `REVOKE` applies to the table that existed when it
 *   ran and to no other. Anything that rebuilds `audit_entries` — a column type
 *   change done the create-copy-swap way, a restore, a squashed migration — has
 *   to re-run this revoke, and nothing in the database will remind it to.
 *   `__tests__/migration-sql.spec.ts` asserts that exactly one migration
 *   creates the table and only that migration's `down()` drops it. It reads a
 *   canonical form of each statement rather than its raw text, so a rebuild
 *   spelled `CREATE TABLE IF NOT EXISTS audit_entries` (with `DROP TABLE IF
 *   EXISTS` beside it) is the same statement to it as the plain spelling —
 *   that gap was disclosed as open for three rounds of that file's review and
 *   is now closed. A rebuild assembled from a variable, or performed through
 *   TypeORM's `QueryRunner` schema API, used to leave that spec nothing to
 *   read at all; both are now ESLint errors in this directory
 *   (`eslint-rules/migration-sql.mjs`), so the SQL has to be written where a
 *   text guard can see it. If you are reading this bullet because you are
 *   about to rebuild this table, re-run this migration's `up()` afterwards
 *   regardless, or the application gets `UPDATE` and `DELETE` on the audit log
 *   back and nothing in the database will say so.
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
  // eslint-disable-next-line migration-sql/sql-is-a-string-literal -- The one shape this rule cannot pin and this backend genuinely needs. The statement is rendered by `format()` IN THE SERVER, from a template that IS a literal at the `exec()` call above and is therefore read by every guard in `__tests__/migration-sql.spec.ts`; only the role name, already validated by `requireAppRoleName`, is interpolated, and `%I` is the parser's own escaping. Postgres refuses a bind parameter in a GRANT or REVOKE, so there is no literal-only way to write this. That spec asserts the EXACT set of exemptions in this directory, so a fourth one turns a test red rather than passing unnoticed.
  await queryRunner.query(rendered[0].sql);
}
