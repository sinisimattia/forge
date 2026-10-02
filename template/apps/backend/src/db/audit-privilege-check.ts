import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * The table whose append-only-ness is D13. Named once, here, because the
 * statement below and the message that explains a failure must agree.
 */
export const AUDIT_TABLE = 'audit_entries';

/**
 * What a deployment is told when it is about to serve over a connection that
 * can rewrite its own audit log.
 *
 * It names `MIGRATION_DATABASE_URL` because that is the variable whose absence
 * produces this state, and there is no other way for an operator to work out
 * from "permission denied" logs that never appear what they were supposed to
 * have set.
 */
export const OVER_PRIVILEGED_MESSAGE
  = `This connection can UPDATE ${AUDIT_TABLE}, so the audit log is not append-only and `
    + 'the application could rewrite its own history. That happens when migrations were run as '
    + 'the same role the application connects as: the role then OWNS the table, and a revoke '
    + 'cannot hold against an owner. Set MIGRATION_DATABASE_URL to the schema owner\'s '
    + 'connection string and re-run the migrations as that role (see compose.prod.yaml), or, if '
    + 'you genuinely do not want this guarantee, say so deliberately rather than by omission. '
    + 'Refusing to start rather than serving without it.';

/**
 * Refuses to serve over a database connection that can rewrite the audit log.
 *
 * ## Why this exists at all when two migrations already arrange it
 *
 * `db/data-source.ts` falls back to `DATABASE_URL` when `MIGRATION_DATABASE_URL`
 * is unset, deliberately — a generated project that cannot migrate at all is the
 * worse failure. The cost of that fallback is a deployment that is neither of
 * the two compose files: it runs its migrations as the application role, that
 * role ends up OWNING `audit_entries`, and `REVOKE UPDATE, DELETE … FROM <app>`
 * cannot hold against an owner, which can grant itself anything back. Nothing
 * fails. Nothing logs. D13 is simply not true any more, and the only way anyone
 * finds out is by trying the `UPDATE` by hand.
 *
 * Both compose files close this by supplying the owner's URL to the migrator and
 * only the restricted role's to the application. **Nothing else does**, and a
 * guarantee that depends on which YAML file you deployed with is a property of a
 * deployment rather than of this program. This check makes it the program's.
 *
 * ## Why it cannot have a false positive, and why the question is about COLUMNS
 *
 * In a correctly configured deployment the application role genuinely lacks
 * `UPDATE` on this table — that is the whole of what the audit migration does.
 * `f` is the configured answer; `t` means the configuration this file describes
 * did not happen. There is no timing in it either: privileges are not cached,
 * and the question is asked of the same connection the application will serve
 * on.
 *
 * **This asked `has_table_privilege` and that was not enough.** A review probed
 * four routes to the privilege against Postgres 16: granted to `PUBLIC`, granted
 * to a group role the application role belongs to (with and without `INHERIT`),
 * and the application role owning the table. `has_table_privilege` reports `t`
 * for all four, so all four are refused. The fifth is a **column** grant —
 * `GRANT UPDATE (action) ON audit_entries TO <app>` — for which
 * `has_table_privilege` reports `f` while the role can execute
 * `UPDATE audit_entries SET action = 'TAMPERED'`, which is the literal statement
 * a proof of D13 would assert is refused. This file used to claim in this
 * paragraph that no third state existed. It did, and the claim is what kept
 * anyone from looking for it.
 *
 * `has_any_column_privilege` answers the question that was meant all along: can
 * this connection write to ANY part of a row in this table. It is `t` wherever
 * `has_table_privilege` is `t` (a table grant implies every column), `t` under
 * the column grant, and `f` under the shipped configuration — verified in all
 * three states, so closing the hole costs no false positive. Both are read, and
 * both are reported, because "you own it" and "somebody granted you one column"
 * are different mistakes with different fixes.
 *
 * Nothing in this template issues a column grant, so that route needs a
 * deliberate act by an operator. It is in the check because a guard that only
 * covers the mistakes its author thought of is a guard nobody can rely on.
 *
 * ## What it does not do
 *
 * It does not stop the project migrating — migrations have already run by the
 * time anything here executes, and they ran through whichever role
 * `db/data-source.ts` resolved. It declines to *serve* over an over-privileged
 * connection, which is the narrower thing, and the one the fallback was never
 * meant to buy.
 *
 * It says nothing about `DELETE`. One privilege is enough to detect the fault
 * this is looking for — an owner holds all of them, and a deployment that has
 * somehow been granted exactly `DELETE` and not `UPDATE` is not a configuration
 * this template can produce. Asking one question keeps the failure message about
 * one thing.
 */
@Injectable()
export class AuditPrivilegeCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditPrivilegeCheck.name);

  public constructor(private readonly dataSource: DataSource) {}

  /**
   * Asks the database, once, whether this connection can rewrite the audit log.
   *
   * `onApplicationBootstrap` rather than a call in `main.ts`: Nest runs it inside
   * `app.init()`, which `listen()` awaits, so throwing here stops the process
   * before a single request is served — and unlike a line in `main.ts` it is
   * reachable from a spec, which is the difference between a guard and a hope.
   *
   * @throws Error when the connection holds `UPDATE` on the audit table
   */
  public async onApplicationBootstrap(): Promise<void> {
    // `current_user`, not the configured role name: the question is about the
    // connection this process is actually going to serve on, and a deployment
    // whose `DATABASE_URL` names a different role than `APP_DB_ROLE` is one of
    // the ways to arrive here. Parameterised, because a table name reaching SQL
    // by concatenation is a habit worth not having even where the value is a
    // module constant.
    const rows: Array<{ granted: boolean; wholeTable: boolean }> = await this.dataSource.query(
      'SELECT has_any_column_privilege(current_user, $1, \'UPDATE\') AS "granted", '
      + 'has_table_privilege(current_user, $1, \'UPDATE\') AS "wholeTable"',
      [AUDIT_TABLE],
    );

    // `!== false` rather than `=== true`: an empty result or an undefined column
    // means the question was not answered, and a guard that treats "I could not
    // tell" as "all clear" is one that stops working the first time the driver's
    // shape changes underneath it. Fails closed.
    if (rows[0]?.granted !== false) {
      // Which of the two mistakes it is, appended rather than branched into a
      // different message: the sentence about `MIGRATION_DATABASE_URL` is right
      // for the common case and useless for a column grant, and an operator
      // reading a refusal needs to know which one they are looking at.
      throw new Error(
        `${OVER_PRIVILEGED_MESSAGE} (${
          rows[0]?.wholeTable === true
            ? `the whole of ${AUDIT_TABLE} is writable by this role`
            : `some column of ${AUDIT_TABLE} carries a column-level UPDATE grant`
        }.)`,
      );
    }

    this.logger.log(`${AUDIT_TABLE} is append-only to this connection.`);
  }
}
