import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `oauth_authorization_requests` — the row that ties a provider's callback
 * back to the request that sent the browser there in the first place.
 *
 * Runs as the schema owner, after `AppRoleAndDefaultPrivileges1758000000000`
 * has set the default privileges, so this table becomes readable and writable
 * by the application role with no `GRANT` in this file. See that migration's
 * own TSDoc for why the ordering is load-bearing, and
 * `__tests__/migration-sql.spec.ts` → `sets the default privileges in the
 * earliest migration of all` for the assertion that it stays first.
 *
 * ## `state_hash`, not `state`
 *
 * The state value travels through the browser and through the provider's own
 * logs on its way back. Storing a hash of it means a leak of this table is not
 * a set of usable pending authorizations — the same reason `refresh_tokens`
 * and `email_verification_tokens` (`IdentityFoundation1758000001000`) store
 * hashes rather than the credentials themselves.
 *
 * `CONSTRAINT uq_oauth_authorization_requests_state UNIQUE (state_hash)`,
 * named rather than an inline `UNIQUE`, matching every other constraint in
 * this schema (`uq_auth_identities_provider_account` is the model) — a named
 * constraint is what an error message quotes when it fires. It is also what
 * makes a reused state a constraint violation rather than a race two
 * concurrent callbacks both win.
 *
 * ## `code_verifier`, in the clear — the one asymmetry worth arguing here
 *
 * `state_hash` and `code_verifier` are opposite kinds of secret, and the
 * column holding each has to follow. The state is what a *caller* proves to
 * this server on the way back in, so this server only ever needs to compare
 * it — a hash is sufficient and a leak of it is inert. The verifier is what
 * *this server* proves to the *provider* at the token exchange, so it has to
 * be recoverable here, in the clear, or the exchange cannot happen at all.
 * Hashing it the way `state_hash` is hashed would make this table correct and
 * the sign-in it exists to complete impossible.
 *
 * ## `purpose`
 *
 * Stored on the request, not inferred at the callback. Sign-in and
 * account-linking share this one table and this one round trip, and the
 * callback has nothing to go on but what this row says: a purpose carried by
 * the URL instead — a query parameter, a route — could be edited by whoever
 * holds the browser between the redirect and the return, downgrading a link
 * to a sign-in or the reverse. `purpose` fixes what was asked for at the
 * moment this server itself asked for it.
 *
 * ## `user_id`, nullable, `ON DELETE CASCADE`
 *
 * Set only when this request is a link — a sign-in has no actor yet, that is
 * the point of it. `ON DELETE CASCADE` for the same reason every other
 * account-owned single-use row in this schema cascades: a deleted account
 * must leave no pending authorization that could later complete against it.
 *
 * ## `consumed_at`
 *
 * A second presentation of one state has to be *visible*, not merely refused,
 * the same shape `email_verification_tokens.consumed_at` and
 * `password_reset_tokens.consumed_at` already carry — a row that stays and
 * says when it was spent, rather than one that is deleted and leaves nothing
 * to distinguish reuse from a state nobody ever issued.
 *
 * ## Which columns carry a `COMMENT ON`
 *
 * A column is commented when a reader holding the *value* of it would handle
 * that value wrongly without being told what it is: a hash standing in for the
 * value (`state_hash`), a secret deliberately held in the clear
 * (`code_verifier`), a value fixed at creation against later edit (`purpose`),
 * and a tombstone that has to stay readable (`consumed_at`). Each comment is
 * about how to treat what is found in the column.
 *
 * `user_id` is not commented, and not because it is obvious: its subtlety is
 * a different kind. It is about *when a row has one at all* — NULL means the
 * request is a sign-in, not that the user is not yet known — and that belongs
 * with the request's purpose, which the `## purpose` and `## user_id` sections
 * above state. `id`, `provider`, `redirect_to`, `created_at` and `expires_at`
 * are what their names say, and a comment repeating the name would only be a
 * second place to keep in step with it. For a column added later: comment it if
 * the value, once read, could be mishandled; put it in prose if the trap is in
 * when the column is set.
 *
 * ## No foreign key to `audit_entries`, and nothing here reads or writes it
 *
 * The rule from `IdentityFoundation1758000001000` and
 * `OrganizationsAndAuthorization1758000003000` applies unchanged: a
 * referential action runs with the table owner's privileges, which would hand
 * the application a route into a table it holds no `UPDATE` or `DELETE` on
 * (ADR-0009, discriminating test D13). This migration does not name
 * `audit_entries` anywhere, which is the simplest way to keep that true.
 */
export class OAuthAuthorizationRequests1758000004000 implements MigrationInterface {
  name = 'OAuthAuthorizationRequests1758000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oauth_authorization_requests (
        id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        state_hash    text        NOT NULL,
        code_verifier text        NOT NULL,
        provider      text        NOT NULL,
        purpose       text        NOT NULL,
        user_id       uuid        NULL REFERENCES users (id) ON DELETE CASCADE,
        redirect_to   text        NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        expires_at    timestamptz NOT NULL,
        consumed_at   timestamptz NULL,
        CONSTRAINT uq_oauth_authorization_requests_state UNIQUE (state_hash)
      )
    `);
    // What the sweep for expired, never-completed requests is run against.
    await queryRunner.query(
      'CREATE INDEX ix_oauth_authorization_requests_expires_at ON oauth_authorization_requests (expires_at)',
    );
    await queryRunner.query(`
      COMMENT ON COLUMN oauth_authorization_requests.state_hash IS
        'A hash of the state value, never the state. A reader of this table cannot use what it holds.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN oauth_authorization_requests.code_verifier IS
        'In the clear, deliberately: this is what the server proves to the provider at the token exchange, not what a caller proves to the server. Hashing it would make the exchange impossible.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN oauth_authorization_requests.purpose IS
        'What this request is for, fixed at the moment it was created — so the callback cannot have its purpose edited by whoever holds the browser in between.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN oauth_authorization_requests.consumed_at IS
        'When this request was consumed, or NULL if it has not been. A second presentation of the same state is visible here rather than merely refused.'
    `);
  }

  /** Drops the table — indexes, constraints and comments go with it. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE oauth_authorization_requests');
  }
}
