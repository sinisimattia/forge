import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The seven tables the identity foundation is made of.
 *
 * Every column is the persistence side of something `__FORGE_SCOPE__/core`
 * already models, plus the material core deliberately does not model: the
 * derivation of a password and the hashes of the single-use credentials. Those
 * live here and nowhere else, which is what makes it structurally impossible
 * for a domain entity to serialize one — there is no field on the entity to put
 * it in.
 *
 * Runs as the schema owner, after `AppRoleAndDefaultPrivileges1758000000000`
 * has set the default privileges, so every table below becomes readable and
 * writable by the application role with no `GRANT` in this file. That ordering
 * is load-bearing: a table created before those default privileges carries
 * none of them, and nothing here would say so.
 *
 * ## `audit_entries.actor_user_id` carries no foreign key, on purpose
 *
 * Every other reference to `users` is `ON DELETE CASCADE`, because a session or
 * a single-use token that outlives its account is not history, it is a way in.
 * The audit table is the opposite: an entry has to outlive the account it
 * refers to, and none of the four things a foreign key could do is acceptable
 * here. Each was tried against Postgres 16 with `UPDATE` and `DELETE` already
 * revoked from the application role:
 *
 * - `ON DELETE CASCADE` — the application deleted a user and the audit row went
 *   with it. It had no `DELETE` privilege on that table; the referential action
 *   runs with the table owner's privileges, so the revoke did not apply.
 * - `ON DELETE SET NULL` — the same, quieter: a direct `UPDATE` on the row was
 *   refused with `permission denied for table audit_entries`, and then deleting
 *   the user rewrote `actor_user_id` to `NULL` on the very same row. Anyone who
 *   can delete an account can erase who did what.
 * - `NO ACTION` / `RESTRICT` — no rewrite, but now the audit log refuses to let
 *   an account be deleted at all, which makes erasing a person's data
 *   impossible for as long as any entry names them.
 * - no foreign key — the row survives the deletion with the id intact.
 *
 * So the column holds a user id that may name nobody, and readers treat a
 * missing user as expected rather than as corruption. This is the one place
 * referential integrity is worth less than the guarantee it would break, which
 * is discriminating test D13.
 */
export class IdentityFoundation1758000001000 implements MigrationInterface {
  name = 'IdentityFoundation1758000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `gen_random_uuid()` is core Postgres from 13 onward — no `pgcrypto`, and
    // deliberately no `CREATE EXTENSION`, which needs a superuser this template
    // does not assume anyone has. The application generates ids itself; these
    // defaults are what keeps a hand-written `INSERT` from needing one.
    await queryRunner.query(`
      CREATE TABLE users (
        id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        email             text        NOT NULL,
        display_name      text        NOT NULL,
        status            text        NOT NULL,
        platform_role     text        NOT NULL,
        email_verified_at timestamptz NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        deleted_at        timestamptz NULL,
        CONSTRAINT uq_users_email UNIQUE (email)
      )
    `);
    // The uniqueness is on the stored value, not on a function of it. The
    // application stores the normal form (core's `normalizeEmail`: trimmed,
    // lowercased) and this constraint is only true because it does — a
    // functional or partial index would move the rule somewhere a reader of
    // the table cannot see it, and would still not save a row inserted by
    // anything that skipped the normalization.
    await queryRunner.query(`
      COMMENT ON COLUMN users.email IS
        'Normal form only (trimmed, lowercased). The unique constraint is on the stored value.'
    `);

    await queryRunner.query(`
      CREATE TABLE auth_identities (
        id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        provider            text        NOT NULL,
        provider_account_id text        NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        last_used_at        timestamptz NULL,
        secret_hash         text        NULL,
        secret_algorithm    text        NULL,
        secret_params       jsonb       NULL,
        CONSTRAINT uq_auth_identities_provider_account UNIQUE (provider, provider_account_id)
      )
    `);
    await queryRunner.query('CREATE INDEX ix_auth_identities_user_id ON auth_identities (user_id)');
    // What makes "one account per address per provider" a fact rather than a
    // hope. The alternative — select, then insert if absent — is a race two
    // concurrent registrations win together.
    await queryRunner.query(`
      COMMENT ON CONSTRAINT uq_auth_identities_provider_account ON auth_identities IS
        'One identity per account per provider, enforced here rather than by a check-then-insert.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN auth_identities.secret_hash IS
        'A one-way derivation of the password, never the password. NULL for every non-password provider.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN auth_identities.secret_params IS
        'The cost parameters the derivation was produced with, so it can be re-derived and upgraded.'
    `);

    await queryRunner.query(`
      CREATE TABLE sessions (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        created_at     timestamptz NOT NULL DEFAULT now(),
        last_used_at   timestamptz NOT NULL DEFAULT now(),
        expires_at     timestamptz NOT NULL,
        revoked_at     timestamptz NULL,
        client_address text        NULL,
        client_label   text        NULL
      )
    `);
    await queryRunner.query('CREATE INDEX ix_sessions_user_id ON sessions (user_id)');

    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id     uuid        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        token_hash     text        NOT NULL,
        replaced_by_id uuid        NULL REFERENCES refresh_tokens (id) ON DELETE SET NULL,
        used_at        timestamptz NULL,
        expires_at     timestamptz NOT NULL,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_refresh_tokens_token_hash UNIQUE (token_hash)
      )
    `);
    // No separate index on `token_hash`: the unique constraint above is
    // implemented as a unique btree index, which is the index every renewal
    // looks the token up through. A second one would be a duplicate the
    // planner never chooses and every insert still maintains.
    await queryRunner.query('CREATE INDEX ix_refresh_tokens_session_id ON refresh_tokens (session_id)');
    await queryRunner.query(`
      COMMENT ON COLUMN refresh_tokens.token_hash IS
        'A hash of the refresh token, never the token. A reader of this table cannot use what it holds.'
    `);
    // A renewal sets `used_at` and points `replaced_by_id` at the successor,
    // so the family stays reconstructible. That is what lets a second
    // presentation of an already-used token be recognized as reuse rather than
    // as an unknown token.
    await queryRunner.query(`
      COMMENT ON COLUMN refresh_tokens.replaced_by_id IS
        'The token issued in this one''s place, so a whole family can be walked when reuse is detected.'
    `);

    // These two tables are structurally identical and are deliberately written
    // out twice rather than emitted from a loop over their names. A loop was
    // tried and reverted: it made the text `CREATE TABLE
    // password_reset_tokens` appear nowhere in this repository, so neither a
    // reader grepping for the table nor `__tests__/migration-sql.spec.ts`
    // could find it — and that spec's whole job is to notice when one of these
    // lines goes missing. Six lines of duplication is the cheaper half of that
    // trade. They are separate tables for the reason
    // `PasswordResetTokenRecord` gives: same shape, different consequences.
    await queryRunner.query(`
      CREATE TABLE email_verification_tokens (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash  text        NOT NULL,
        expires_at  timestamptz NOT NULL,
        consumed_at timestamptz NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_email_verification_tokens_token_hash UNIQUE (token_hash)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX ix_email_verification_tokens_user_id ON email_verification_tokens (user_id)',
    );
    await queryRunner.query(`
      COMMENT ON COLUMN email_verification_tokens.token_hash IS
        'A hash of the single-use token, never the token. A reader of this table cannot use what it holds.'
    `);

    await queryRunner.query(`
      CREATE TABLE password_reset_tokens (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash  text        NOT NULL,
        expires_at  timestamptz NOT NULL,
        consumed_at timestamptz NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_password_reset_tokens_token_hash UNIQUE (token_hash)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX ix_password_reset_tokens_user_id ON password_reset_tokens (user_id)',
    );
    await queryRunner.query(`
      COMMENT ON COLUMN password_reset_tokens.token_hash IS
        'A hash of the single-use token, never the token. A reader of this table cannot use what it holds.'
    `);

    await queryRunner.query(`
      CREATE TABLE audit_entries (
        id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id text        NULL,
        actor_user_id   uuid        NULL,
        action          text        NOT NULL,
        resource_type   text        NULL,
        resource_id     text        NULL,
        metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
        client_address  text        NULL,
        client_label    text        NULL,
        occurred_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query('CREATE INDEX ix_audit_entries_occurred_at ON audit_entries (occurred_at)');
    await queryRunner.query('CREATE INDEX ix_audit_entries_actor_user_id ON audit_entries (actor_user_id)');
    await queryRunner.query(`
      COMMENT ON COLUMN audit_entries.actor_user_id IS
        'Who acted, or NULL when nobody was identified. Deliberately not a foreign key: every referential action either deletes history or rewrites it behind the application''s back.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN audit_entries.metadata IS
        'Whatever is worth reconstructing later. Never anything secret — this is the most-read table in an incident and the least-protected in a backup.'
    `);
  }

  /** Drops the seven tables, children before parents. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE audit_entries');
    await queryRunner.query('DROP TABLE password_reset_tokens');
    await queryRunner.query('DROP TABLE email_verification_tokens');
    await queryRunner.query('DROP TABLE refresh_tokens');
    await queryRunner.query('DROP TABLE sessions');
    await queryRunner.query('DROP TABLE auth_identities');
    await queryRunner.query('DROP TABLE users');
  }
}
