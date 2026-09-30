import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `mfa_methods`, `mfa_recovery_codes` and `mfa_challenges` — the three tables
 * multi-factor authentication is built from.
 *
 * Runs as the schema owner, after `AppRoleAndDefaultPrivileges1758000000000`
 * has set the default privileges, so all three tables become readable and
 * writable by the application role with no `GRANT` in this file — the same
 * ordering `OAuthAuthorizationRequests1758000004000` and every schema
 * migration before it rely on, and that `migration-sql.spec.ts` pins.
 *
 * ## `type` and `purpose` carry no `CHECK`, on purpose
 *
 * `mfa_methods.type` and `mfa_challenges.purpose` are plain `text NOT NULL`,
 * unconstrained by the database — consistent with `provider` on
 * `auth_identities` and `purpose` on `oauth_authorization_requests`, which is
 * every enum-ish column this schema has ever had. That is a decision, not
 * something left half-finished: a `CHECK` would duplicate the set of values
 * `MfaMethodType` and `MfaChallengePurpose` already enumerate in TypeScript,
 * and duplicating an enumeration is how the two drift apart — a database that
 * refuses a value the application has since learned to write, or the reverse,
 * a `CHECK` and an enum silently disagreeing about a member neither guards.
 * A row this database would accept but no code models is instead refused
 * where a person can see *why*: `mapMfaMethodRecord` for `type`, and whatever
 * reads `purpose` off a challenge row for that column — dispatch on the
 * modelled enum by explicit equality per member, ending in an unconditional
 * throw, never a `default` that proceeds and never a ternary that reads "not
 * A, so it must be B". Do not "finish" this migration by adding the `CHECK`
 * back; the refusal belongs in code, where it can say what was wrong with the
 * value, not merely that Postgres declined it.
 *
 * ## `mfa_methods`: one table, two unrelated kinds of proof
 *
 * A method's identity — that it exists, belongs to this user, and carries
 * this label — is one property whichever kind of second factor it is;
 * splitting TOTP and WebAuthn into two tables would mean every caller that
 * lists or removes a method joining across both. The price is five columns
 * that are `NULL` for one type and populated for the other: `totp_secret` and
 * `totp_last_step` iff `type = 'TOTP'`; `webauthn_credential_id`,
 * `webauthn_public_key` and `webauthn_counter` iff `type = 'WEBAUTHN'`.
 * `mapMfaMethodRecord` is what turns that "iff" into an enforced property
 * rather than a comment nobody checks: a `TOTP` row with a null
 * `totp_secret` is not a method that merely fails to verify, it is an account
 * whose login now demands a factor it can never supply — a lockout — so it is
 * refused at read, where somebody can still see it, rather than at the next
 * sign-in attempt made by the person it has trapped.
 *
 * `CONSTRAINT uq_mfa_methods_webauthn_credential UNIQUE (webauthn_credential_id)`
 * — named, matching `uq_auth_identities_provider_account` — registers one
 * WebAuthn credential once across the whole deployment. `NULL` never
 * conflicts with `NULL` in a unique constraint, so every `TOTP` row sharing
 * that column's `NULL` is not a violation waiting to happen.
 *
 * ## `mfa_recovery_codes`: no state column
 *
 * `consumed_at` is the whole of a code's lifecycle: `NULL` or an instant,
 * with no third value for a reader to fail open on — unlike `type` and
 * `purpose`, a nullable timestamp needs no code-side refusal because it has
 * no member a corrupted write could invent. `code_hash` is a hash, never the
 * code, for the same reason `refresh_tokens`, `email_verification_tokens` and
 * `oauth_authorization_requests` all store a hash rather than the credential
 * itself: a leak of this table must hand nobody a usable code.
 * `CONSTRAINT uq_mfa_recovery_codes_code_hash UNIQUE (code_hash)` is
 * meaningful precisely because the hash (`hashOpaqueToken`, sha256) is
 * deterministic — under a salted derivation two callers could never collide
 * on it and the constraint would be decorative.
 *
 * ## `mfa_challenges`: a token that proves nothing but its own purpose
 *
 * `token_hash`, not `token` — the same asymmetry as `mfa_recovery_codes` and
 * `oauth_authorization_requests.state_hash`. `purpose` is fixed by whichever
 * endpoint minted the row (`POST /auth/login` writes `LOGIN`;
 * `POST /mfa/webauthn/options` on an authenticated session writes
 * `WEBAUTHN_ENROLLMENT`), never by anything a caller sends on the request
 * that later consumes it — the same mechanism
 * `OAuthAuthorizationRequests1758000004000`'s own `purpose` column
 * established, applied here to the exact shape the roadmap warns this phase
 * about: a value nothing matches falling through a ternary into a session
 * being minted anyway. `webauthn_challenge` is the ceremony nonce and is
 * `NULL` for a `LOGIN` row that never entered a WebAuthn round.
 * `CONSTRAINT uq_mfa_challenges_token_hash UNIQUE (token_hash)` — named, for
 * the reason `uq_oauth_authorization_requests_state`'s own TSDoc gives: it
 * makes a replayed token a constraint violation rather than a race two
 * concurrent requests both win.
 */
export class Mfa1758000005000 implements MigrationInterface {
  name = 'Mfa1758000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mfa_methods (
        id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        type                   text        NOT NULL,
        label                  text        NOT NULL,
        totp_secret            text        NULL,
        totp_last_step         bigint      NULL,
        webauthn_credential_id text        NULL,
        webauthn_public_key    text        NULL,
        webauthn_counter       bigint      NULL,
        confirmed_at           timestamptz NULL,
        last_used_at           timestamptz NULL,
        created_at             timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_mfa_methods_webauthn_credential UNIQUE (webauthn_credential_id)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX ix_mfa_methods_user_id ON mfa_methods (user_id)',
    );

    await queryRunner.query(`
      CREATE TABLE mfa_recovery_codes (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        code_hash   text        NOT NULL,
        consumed_at timestamptz NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_mfa_recovery_codes_code_hash UNIQUE (code_hash)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX ix_mfa_recovery_codes_user_id ON mfa_recovery_codes (user_id)',
    );

    await queryRunner.query(`
      CREATE TABLE mfa_challenges (
        id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        token_hash         text        NOT NULL,
        purpose            text        NOT NULL,
        webauthn_challenge text        NULL,
        expires_at         timestamptz NOT NULL,
        consumed_at        timestamptz NULL,
        created_at         timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_mfa_challenges_token_hash UNIQUE (token_hash)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX ix_mfa_challenges_user_id ON mfa_challenges (user_id)',
    );

    await queryRunner.query(`
      COMMENT ON COLUMN mfa_methods.type IS
        'TOTP or WEBAUTHN, unconstrained here on purpose — mapMfaMethodRecord refuses fail-closed at read. See this migration''s own TSDoc.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN mfa_methods.totp_secret IS
        'Present iff type = ''TOTP''. mapMfaMethodRecord refuses a TOTP row where this is null: a lockout, not a verification failure.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN mfa_recovery_codes.code_hash IS
        'A hash of the code, never the code. A reader of this table cannot use what it holds.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN mfa_challenges.token_hash IS
        'A hash of the token, never the token. A reader of this table cannot use what it holds.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN mfa_challenges.purpose IS
        'LOGIN or WEBAUTHN_ENROLLMENT, unconstrained here on purpose — fixed by whichever endpoint minted this row, never by the request that consumes it. See this migration''s own TSDoc.'
    `);
  }

  /** Drops the tables — indexes, constraints and comments go with them. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE mfa_challenges');
    await queryRunner.query('DROP TABLE mfa_recovery_codes');
    await queryRunner.query('DROP TABLE mfa_methods');
  }
}
