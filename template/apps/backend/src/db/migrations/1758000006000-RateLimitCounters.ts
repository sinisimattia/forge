import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `rate_limit_counters` — one row per throttled subject per window.
 *
 * Runs as the schema owner, after `AppRoleAndDefaultPrivileges1758000000000`
 * has set the default privileges, so this table becomes readable and writable
 * by the application role with no `GRANT` in this file. See that migration's
 * own TSDoc for why the ordering is load-bearing.
 *
 * ## Why a table, when the library ships a store
 *
 * The bundled store is a map in the process. With one instance it is correct.
 * With several, each keeps its own count, so the effective limit becomes the
 * configured one multiplied by the number of instances — silently, with every
 * test green, because nothing in a single-process suite can observe it. A
 * limit that quietly is not the limit is the failure this schema exists to
 * prevent.
 *
 * ## `key` is the primary key, and it is opaque here
 *
 * The library composes it from the bucket's name and the subject. This table
 * does not parse it and must not: what a subject is belongs to the tracker,
 * and a schema that knew would have to change whenever a bucket did.
 *
 * ## No foreign key to `users`
 *
 * A row's subject is often an account, and it is deliberately not a reference.
 * The counter must survive the thing it counts — an attempt against an address
 * that names nobody is exactly the case that must still be metered — and a
 * referential action here would delete a live budget when an account went away.
 */
export class RateLimitCounters1758000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rate_limit_counters (
        key           text        PRIMARY KEY,
        hits          integer     NOT NULL,
        expires_at    timestamptz NOT NULL,
        blocked_until timestamptz NULL
      )
    `);
    // What the sweep for finished windows is run against. Without it the sweep
    // is a sequential scan of every subject ever counted.
    await queryRunner.query(
      'CREATE INDEX ix_rate_limit_counters_expires_at ON rate_limit_counters (expires_at)',
    );
    await queryRunner.query(`
      COMMENT ON COLUMN rate_limit_counters.key IS
        'Bucket and subject, composed by the application. Opaque here: this table never parses it.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN rate_limit_counters.blocked_until IS
        'When the refusal lifts, or NULL while the subject is still within its budget.'
    `);
    // `mfa_challenges` was created without this index. The sweep that runs on
    // every mint filters on `expires_at`, so it scanned the whole table.
    await queryRunner.query(
      'CREATE INDEX ix_mfa_challenges_expires_at ON mfa_challenges (expires_at)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_mfa_challenges_expires_at');
    await queryRunner.query('DROP TABLE rate_limit_counters');
  }
}
