import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The four Phase 3 tables — `organizations`, `memberships`,
 * `organization_invitations`, `resource_grants` — and the one column that had
 * to wait for them: `audit_entries.organization_id` becomes a real `uuid`.
 *
 * Runs as the schema owner, after `AppRoleAndDefaultPrivileges1758000000000`
 * has set the default privileges, so every table below becomes readable and
 * writable by the application role with no `GRANT` in this file. See that
 * migration's own TSDoc for why the ordering is load-bearing, and
 * `__tests__/migration-sql.spec.ts` → `sets the default privileges in the
 * earliest migration of all` for the assertion that it stays first.
 *
 * ## `audit_entries.organization_id`: `text` → `uuid`, and no foreign key
 *
 * `IdentityFoundation1758000001000` shipped this column as `text` because core
 * had no `OrganizationId` to brand it with yet, and said so in its own
 * comment. Phase 3 gives core that type, so the column can finally hold what it
 * always meant to.
 *
 * `USING organization_id::uuid` is safe because nothing has ever written a
 * non-null value into this column: every call site that constructs a
 * `RecordAuditEntryInput` in this phase — `AuditService.record` itself,
 * `AuthService`, `UsersService`, `IdentitiesService`, `RefreshTokenService`,
 * `PlatformAdminOverrideInterceptor` — passes `organizationId: null` literally.
 * Verified two ways before writing this migration:
 *
 * - Statically: `grep -rn "organizationId" apps/backend/src/{audit,auth,identities,users}`
 *   shows every write site as the literal `null`, never a variable.
 * - Dynamically, against the database this migration is about to run against:
 *   `SELECT count(*) FROM audit_entries WHERE organization_id IS NOT NULL`
 *   returned `0`. Recorded in Task 9's report alongside the privilege
 *   verification below.
 *
 * **No foreign key to `organizations`, and this is where the temptation
 * arrives** — more than it did for `actor_user_id`, because this column is
 * *becoming* a `uuid` that names a table which now exists, and adding
 * `REFERENCES organizations (id)` here looks like finishing the job rather than
 * like breaking it. It is the second: a referential action runs with the TABLE
 * OWNER's privileges, not the caller's, so any foreign key on this table hands
 * the application a route into it that the two-role split was built to deny —
 * `ON DELETE CASCADE` erases the audit rows naming a deleted organization,
 * `ON DELETE SET NULL` is refused as a direct `UPDATE` and then rewrites the
 * very same row's `organization_id` the moment the organization is deleted
 * ("who did what" survives, "in which tenant" does not), and `NO ACTION` /
 * `RESTRICT` makes an organization impossible to delete for as long as any
 * entry names it. All four were measured against Postgres 16 for
 * `actor_user_id` in Phase 2 (see `IdentityFoundation1758000001000`); the
 * result is identical here because it is a property of referential actions,
 * not of that column. ADR-0009, and discriminating test D13.
 *
 * `migration-sql.spec.ts` asserts this two ways that do not depend on this
 * file staying well-behaved: `audit_entries is never given a foreign key`
 * scans every migration for `audit_entries` followed by `REFERENCES` in the
 * same statement, and `the organizations-and-authorization migration › adds
 * no foreign key to audit_entries, in any migration` scans the reverse
 * direction — some other table's `REFERENCES audit_entries` — which is the one
 * this migration could actually introduce.
 */
export class OrganizationsAndAuthorization1758000003000 implements MigrationInterface {
  name = 'OrganizationsAndAuthorization1758000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE organizations (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        name       text        NOT NULL,
        slug       text        NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,
        CONSTRAINT uq_organizations_slug UNIQUE (slug)
      )
    `);

    // `uq_memberships_org_user` is the database's half of "a person is a
    // member of an organization at most once" — the contract asserts it
    // (`IOrganizationServiceContractDeps`), and this makes a concurrent
    // double-insert impossible rather than unlikely, the same reasoning
    // `uq_auth_identities_provider_account` carries in the identity foundation.
    await queryRunner.query(`
      CREATE TABLE memberships (
        id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        role            text        NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_memberships_org_user UNIQUE (organization_id, user_id)
      )
    `);
    await queryRunner.query('CREATE INDEX ix_memberships_user ON memberships (user_id)');

    await queryRunner.query(`
      CREATE TABLE organization_invitations (
        id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        email               text        NOT NULL,
        role                text        NOT NULL,
        status              text        NOT NULL,
        token_hash          text        NOT NULL,
        invited_by_user_id  uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
        expires_at          timestamptz NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        accepted_at         timestamptz NULL,
        accepted_by_user_id uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT uq_organization_invitations_token_hash UNIQUE (token_hash)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX ix_organization_invitations_org ON organization_invitations (organization_id)',
    );
    // Same rule as `email_verification_tokens.token_hash` and
    // `password_reset_tokens.token_hash`: a hash, never the token, carried
    // across verbatim because the reason does not change with the table.
    await queryRunner.query(`
      COMMENT ON COLUMN organization_invitations.token_hash IS
        'A hash of the single-use token, never the token. A reader of this table cannot use what it holds.'
    `);

    await queryRunner.query(`
      CREATE TABLE resource_grants (
        id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
        subject_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        resource_type   text        NOT NULL,
        resource_id     text        NOT NULL,
        permission      text        NOT NULL,
        granted_by      uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        expires_at      timestamptz NULL
      )
    `);
    await queryRunner.query(
      'CREATE INDEX ix_resource_grants_subject ON resource_grants (subject_user_id, organization_id)',
    );

    // See this class's own TSDoc for the verification behind `USING
    // organization_id::uuid` being safe, and for why no foreign key to
    // `organizations` follows it.
    await queryRunner.query(`
      ALTER TABLE audit_entries
        ALTER COLUMN organization_id TYPE uuid USING organization_id::uuid
    `);
  }

  /**
   * Reverses the alter first — back to `text`, the same way it arrived — then
   * drops the four tables children before parents. A `down()` that could not
   * restore the prior column type would be a `down()` nobody could run against
   * a database that still had this migration's rows in it.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE audit_entries
        ALTER COLUMN organization_id TYPE text USING organization_id::text
    `);

    await queryRunner.query('DROP TABLE resource_grants');
    await queryRunner.query('DROP TABLE organization_invitations');
    await queryRunner.query('DROP TABLE memberships');
    await queryRunner.query('DROP TABLE organizations');
  }
}
