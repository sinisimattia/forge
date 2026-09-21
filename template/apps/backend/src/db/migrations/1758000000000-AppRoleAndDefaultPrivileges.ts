import type { MigrationInterface, QueryRunner } from 'typeorm';
import { requireAppRoleName, requireAppRolePassword } from '../app-role';

/**
 * A marker meaning "substitute `current_database()` here", not a value.
 *
 * The database's own name is the one identifier that must not come from
 * configuration: the statement has to name the database the migration is
 * actually connected to, and a second variable saying which one that is could
 * disagree with the connection string.
 */
const currentDatabase = Symbol('current_database()');

/**
 * Builds a statement with `format()` in the server and runs it.
 *
 * The format string is a literal at every call site below, so the SQL this
 * migration runs is readable in this file — and assertable by
 * `__tests__/migration-sql.spec.ts`, which reads the source as text.
 *
 * @param queryRunner - the migration's query runner
 * @param template - a `format()` template; `%I` for an identifier, `%L` for a literal
 * @param args - the values for its placeholders, in order; `currentDatabase`
 * becomes a `current_database()` call rather than a bind parameter
 */
async function exec(
  queryRunner: QueryRunner,
  template: string,
  ...args: (string | typeof currentDatabase)[]
): Promise<void> {
  const bound: string[] = [];
  const placeholders = args.map((arg) => {
    if (arg === currentDatabase) return 'current_database()';
    bound.push(arg);
    // $1 is the template itself, so the bound values start at $2.
    return `$${bound.length + 1}::text`;
  });
  // `format($1::text, )` is a syntax error, so a template with no placeholders
  // gets the one-argument form. `format()` with one argument is not a no-op —
  // it still collapses `%%` to `%` — so this stays a `format()` call rather
  // than running the template directly.
  const rendered: { sql: string }[] = await queryRunner.query(
    // eslint-disable-next-line migration-sql/sql-is-a-string-literal -- Not a schema statement: this is the `format()` plumbing that renders one, and its own text is fixed here rather than coming from anywhere a migration author writes. The schema statement is the `template` argument at the `exec()` call, which is a literal and is what the guards read.
    placeholders.length === 0
      ? 'SELECT format($1::text) AS sql'
      : `SELECT format($1::text, ${placeholders.join(', ')}) AS sql`,
    [template, ...bound],
  );
  // eslint-disable-next-line migration-sql/sql-is-a-string-literal -- The one shape this rule cannot pin and this backend genuinely needs. The statement is rendered by `format()` IN THE SERVER, from a template that IS a literal at the `exec()` call above and is therefore read by every guard in `__tests__/migration-sql.spec.ts`; only the role name, already validated by `requireAppRoleName`, is interpolated, and `%I` is the parser's own escaping. Postgres refuses a bind parameter in a GRANT or REVOKE, so there is no literal-only way to write this. That spec asserts the EXACT set of exemptions in this directory, so a fourth one turns a test red rather than passing unnoticed.
  await queryRunner.query(rendered[0].sql);
}

/**
 * Creates the restricted role the application runs as, and arranges that every
 * table a later migration creates is writable by it without anyone remembering
 * to say so.
 *
 * ## Why there are two roles
 *
 * Migrations run as the schema owner — the role the Postgres image creates, the
 * one that owns every table. The running application connects as a second role
 * that owns nothing. That separation is not tidiness: it is the only thing that
 * can make a table append-only *to the application*. A privilege revoked from
 * the owner is not a restriction, because the owner can grant it straight back
 * to itself; a privilege revoked from a non-owner is one the application cannot
 * recover, because granting requires a privilege it does not have. Without two
 * roles there is no statement you can write that the application cannot undo,
 * and `audit_entries` being append-only would be a convention rather than a
 * property. That property is discriminating test D13.
 *
 * Verified, against Postgres 16, as the application role: `GRANT UPDATE ON
 * audit_entries TO <app>` does not error — Postgres grants whatever subset the
 * grantor holds grant options for and raises `WARNING: no privileges were
 * granted` for the rest — but it grants nothing, and `has_table_privilege`
 * still reports `f`. `SET ROLE owner` is refused outright. So the guarantee
 * holds; what does not hold is the intuition that the attempt raises an error.
 *
 * ## Why the ordering matters
 *
 * `ALTER DEFAULT PRIVILEGES` applies only to objects created *after* it. It is
 * run here, in the first migration, before any table exists, so that the schema
 * migration and every schema migration a later phase adds are covered with no
 * accompanying `GRANT`. Verified: a table created before the statement carries
 * no privileges for the role, and one created after carries all four.
 *
 * ## Why the statements are built with `format()`
 *
 * Postgres does not accept bind parameters in utility statements — `CREATE ROLE
 * app LOGIN PASSWORD $1` fails to parse, at parse time, with `syntax error at
 * or near "$1"`. The role name and the password therefore have to become part
 * of the statement text. `format('%I', …)` quotes and escapes an identifier and
 * `format('%L', …)` a literal, both in the server, which is the one place that
 * agrees with the parser about what escaping means.
 */
export class AppRoleAndDefaultPrivileges1758000000000 implements MigrationInterface {
  name = 'AppRoleAndDefaultPrivileges1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const role = requireAppRoleName();
    const password = requireAppRolePassword();

    // Idempotent by an explicit guard rather than by catching the error: an
    // unguarded second run fails with `role "…" already exists`, and a
    // migration that has to be re-run against a database where the role was
    // provisioned by hand is an ordinary situation, not a fault.
    //
    // The guard is in TypeScript, and `CREATE ROLE` is its own single
    // statement, so that the password reaches SQL through `format('%L')` with
    // nothing wrapped around it. This was a `DO $do$ … $do$` block whose body
    // carried the rendered `%L` literal, and that is broken: Postgres ends a
    // dollar-quoted string at its tag no matter what quoting is inside it, so
    // `%L` escaping does not survive the outer quoting at all. A password
    // containing `$do$` produced `ERROR: unterminated quoted string`, pointing
    // at a line with nothing wrong with it, and the tail of the password was
    // left sitting outside any string — under a client that splits statements
    // itself, it ran. Demonstrated with `x$do$; DROP TABLE canary; SELECT $do$`
    // as the password: the canary table was dropped. Choosing a more obscure
    // tag would only move the same goalposts.
    //
    // A bind parameter is fine on *this* statement, unlike the one below:
    // `SELECT … WHERE rolname = $1` is an ordinary query, and it is utility
    // statements like `CREATE ROLE` that reject parameters.
    //
    // Between the check and the create there is a race, and it is the same race
    // the `DO` block had: `pg_roles` is read from the transaction's snapshot and
    // `CREATE ROLE` takes no predicate lock, so two migration runs starting at
    // once can both find the role absent. TypeORM takes no advisory lock around
    // migrations — checked, `MigrationExecutor` only opens a transaction — so
    // nothing above prevents it either. The loser gets `role "…" already
    // exists` and its whole migration rolls back, which is a loud, correct
    // failure for "two people migrated the same database at the same moment".
    const existing: unknown[] = await queryRunner.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [role],
    );
    if (existing.length === 0) {
      await exec(queryRunner, 'CREATE ROLE %I LOGIN PASSWORD %L', role, password);
    }

    // Both are no-ops on a stock database, where PUBLIC already holds CONNECT
    // on every database and USAGE on schema `public` — and both stop being
    // no-ops the moment somebody hardens the deployment. Verified: after
    // `REVOKE CONNECT ON DATABASE … FROM PUBLIC` and `REVOKE USAGE ON SCHEMA
    // public FROM PUBLIC`, a role without these two grants reports `f` for both
    // and cannot connect, while the application role still reports `t`. They
    // are the difference between this schema surviving that hardening and
    // failing at connect time with no obvious cause.
    await exec(queryRunner, 'GRANT CONNECT ON DATABASE %I TO %I', currentDatabase, role);
    await exec(queryRunner, 'GRANT USAGE ON SCHEMA public TO %I', role);

    await exec(
      queryRunner,
      `ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public
         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I`,
      role,
    );

    // Grants nothing today, and that was worth measuring rather than assuming.
    // No table in this schema owns a sequence — every primary key is a `uuid`
    // with a `gen_random_uuid()` default. `pg_class` does report one,
    // `migrations_id_seq`, and it is not this schema's: it belongs to TypeORM's
    // own ledger table, which TypeORM creates before the first migration runs
    // and which the application role therefore holds no privilege on at all
    // (`has_sequence_privilege` reports `f` for both, and the ledger table
    // itself reports `f` for all five — an incidental but welcome consequence
    // of the ordering this migration depends on).
    //
    // It is here for exactly the reason the TABLES line above is: both exist
    // for objects that do not exist yet. The first later phase to add a
    // `serial` or `GENERATED … AS IDENTITY` column would otherwise get
    // `permission denied for sequence` at its first insert, with the fix living
    // in a migration nobody would think to look at.
    await exec(
      queryRunner,
      `ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public
         GRANT USAGE, SELECT ON SEQUENCES TO %I`,
      role,
    );
  }

  /**
   * Undoes the grants and drops the role.
   *
   * There is no guard around the drop and deliberately so. A role that still
   * holds a privilege anywhere cannot be dropped, and Postgres refuses it with
   * a `DETAIL` that lists every remaining dependency by name — `privileges for
   * table users`, `privileges for schema public` — which is strictly more
   * useful than anything a pre-check here could say. TypeORM runs a migration's
   * `down()` in a transaction, so that refusal rolls the revokes back with it:
   * the failure is loud and the database is unchanged, which is what "fail
   * clearly rather than half-succeed" asks for.
   *
   * `DROP OWNED BY` would make the drop succeed unconditionally and is
   * rejected for that reason: it destroys every object the role owns, so a
   * later phase that gave the application role anything of its own would lose
   * it to a routine revert.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const role = requireAppRoleName();

    await exec(
      queryRunner,
      `ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public
         REVOKE USAGE, SELECT ON SEQUENCES FROM %I`,
      role,
    );
    await exec(
      queryRunner,
      `ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public
         REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM %I`,
      role,
    );
    await exec(queryRunner, 'REVOKE USAGE ON SCHEMA public FROM %I', role);
    await exec(queryRunner, 'REVOKE CONNECT ON DATABASE %I FROM %I', currentDatabase, role);
    await exec(queryRunner, 'DROP ROLE %I', role);
  }
}
