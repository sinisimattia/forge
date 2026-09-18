import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireAppRoleName, requireAppRolePassword } from '../app-role';

/**
 * What a unit test can honestly say about a migration.
 *
 * **This file is not the append-only guarantee.** It reads the migrations as
 * *text* and checks that the statements which produce that guarantee are
 * written and have not been written back out again. Text cannot show that the
 * database refuses anything: a migration could contain a perfect `REVOKE` and
 * still be pointed at a role nobody connects as, or be undone by a fourth
 * migration nobody added yet. The proof that a real `UPDATE` on `audit_entries`
 * is rejected by a real Postgres is discriminating test D13, which runs against
 * the booted stack in Task 19's docker end-to-end, and nowhere else.
 *
 * What text is good for is the reverse direction: catching the deletion. Every
 * assertion here exists because removing one line from a migration would make
 * D13 quietly stop being true, and a schema migration is exactly the kind of
 * file somebody edits months later without knowing which line was load-bearing.
 */

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/** A migration's source, by the filename fragment that identifies it. */
function migrationSource(fragment: string): string {
  const file = readdirSync(MIGRATIONS_DIR).find((name) => name.includes(fragment));
  if (file === undefined) throw new Error(`No migration matching ${fragment} in ${MIGRATIONS_DIR}`);
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

/**
 * Just the `up()` half of a migration.
 *
 * Needed because `down()` legitimately contains the opposite of everything
 * `up()` does — the audit migration's `down()` grants back exactly the two
 * privileges `up()` revokes, which is what a revert *is*. An assertion about
 * "the migration grants nothing back" that read the whole file would either be
 * false or would have to be weakened until it no longer said anything.
 */
function upBody(source: string): string {
  const start = source.indexOf('public async up(');
  const end = source.indexOf('public async down(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the audit migration', () => {
  const source = migrationSource('AuditAppendOnly');

  it('revokes UPDATE and DELETE from the application role', () => {
    expect(upBody(source)).toContain('REVOKE UPDATE, DELETE ON audit_entries FROM %I');
  });

  it('grants nothing back in the same breath', () => {
    expect(upBody(source)).not.toMatch(/GRANT\b/);
  });

  it('names the role through the shared reader rather than a literal', () => {
    // A literal role name here and a different one in the migration that
    // creates the role would harden a role nobody connects as, and nothing
    // would fail to say so.
    expect(source).toContain('requireAppRoleName()');
  });

  it('restores both privileges in down(), so a revert is a real revert', () => {
    const down = source.slice(source.indexOf('public async down('));
    expect(down).toContain('GRANT UPDATE, DELETE ON audit_entries TO %I');
  });
});

describe('the schema migration', () => {
  const source = migrationSource('IdentityFoundation');

  /**
   * The column list of one `CREATE TABLE`, and nothing after it.
   *
   * Slicing first is not tidiness. The assertions below were written as a
   * single regex per table — `CREATE TABLE sessions \([\s\S]*?REFERENCES users
   * \(id\) ON DELETE CASCADE` — and every one of them passed with the cascade
   * deleted from `sessions`, because `[\s\S]*?` is unbounded and simply ran on
   * into the next table that still had one. They could not fail. Bounding the
   * search to the statement is what makes them able to.
   */
  function createTableBody(table: string): string {
    const match = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\s*\\)`).exec(source);
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('creates audit_entries with a nullable actor_user_id', () => {
    expect(createTableBody('audit_entries')).toMatch(/actor_user_id\s+uuid\s+NULL/);
  });

  it('gives audit_entries no foreign key', () => {
    // The one assertion here that is not about a deleted line but an added
    // one. A foreign key's referential action runs with the table owner's
    // privileges, not the caller's, so an `ON DELETE CASCADE` or `SET NULL`
    // pointing at this table hands the application a way to delete or rewrite
    // an audit row through a statement aimed at `users` — straight past the
    // REVOKE. Adding `@ManyToOne` to the record class or `REFERENCES` here is
    // the natural, tidy-looking change that silently ends D13.
    expect(createTableBody('audit_entries')).not.toMatch(/REFERENCES/);
  });

  it('cascades every other reference to users, so nothing outlives an account', () => {
    for (const table of [
      'auth_identities',
      'sessions',
      'email_verification_tokens',
      'password_reset_tokens',
    ]) {
      expect(createTableBody(table)).toContain('REFERENCES users (id) ON DELETE CASCADE');
    }
  });

  it('makes the email and provider-account uniqueness constraints, not comments', () => {
    expect(source).toContain('CONSTRAINT uq_users_email UNIQUE (email)');
    expect(source).toContain(
      'CONSTRAINT uq_auth_identities_provider_account UNIQUE (provider, provider_account_id)',
    );
  });

  it('says in the database that every token column holds a hash', () => {
    // A COMMENT ON COLUMN survives into `\d+`, where somebody reading the table
    // in psql at three in the morning will actually see it. A TypeScript
    // comment does not reach them.
    const comments = source.match(/COMMENT ON COLUMN [a-z_.]*token_hash IS/g) ?? [];
    expect(comments).toHaveLength(3);
    expect(source).toContain('COMMENT ON COLUMN auth_identities.secret_hash IS');
  });
});

describe('every migration', () => {
  const sources = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [name, readFileSync(join(MIGRATIONS_DIR, name), 'utf8')] as const);

  it('exists', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources)('%s does not mention synchronize', (_name, source) => {
    // `synchronize: true` anywhere would let TypeORM reshape the schema from
    // the entity classes, which is how a hand-written REVOKE gets dropped on
    // the floor without anybody writing a line to drop it.
    expect(source).not.toContain('synchronize');
  });

  it('sets the default privileges in the earliest migration of all', () => {
    // The ordering is the mechanism: `ALTER DEFAULT PRIVILEGES` covers only
    // objects created after it, so a schema migration that sorted before this
    // one would produce tables the application cannot touch — and the failure
    // would arrive at the first request, not here.
    const withDefaultPrivileges = sources
      .filter(([, source]) => source.includes('ALTER DEFAULT PRIVILEGES'))
      .map(([name]) => name);
    expect(withDefaultPrivileges).toHaveLength(1);
    expect(withDefaultPrivileges[0]).toBe([...sources].map(([name]) => name).sort()[0]);
  });
});

describe('the application role configuration', () => {
  const saved = { role: process.env.APP_DB_ROLE, password: process.env.APP_DB_PASSWORD };

  afterEach(() => {
    // Assigning `undefined` to a `process.env` key stores the string
    // "undefined", which would leave the next test reading a role name that
    // passes validation and means nothing.
    restore('APP_DB_ROLE', saved.role);
    restore('APP_DB_PASSWORD', saved.password);
  });

  function restore(key: string, value: string | undefined): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it('throws when APP_DB_ROLE is absent', () => {
    delete process.env.APP_DB_ROLE;
    expect(() => requireAppRoleName()).toThrow(/APP_DB_ROLE is not set/);
  });

  it('throws when APP_DB_PASSWORD is absent, rather than defaulting to one', () => {
    // A default here would be a credential shipped in every project generated
    // from this template, and known to everyone who has ever read it.
    delete process.env.APP_DB_PASSWORD;
    expect(() => requireAppRolePassword()).toThrow(/APP_DB_PASSWORD is not set/);
  });

  it.each(['ev\'il', 'two words', '1leading-digit', 'UPPER', 'a'.repeat(64), ''])(
    'rejects the role name %p',
    (role) => {
      process.env.APP_DB_ROLE = role;
      expect(() => requireAppRoleName()).toThrow(/APP_DB_ROLE/);
    },
  );

  it.each(['my-app-app', 'blog-app', 'a', '_app', 'a'.repeat(63)])(
    'accepts the role name %p',
    (role) => {
      // `my-app-app` is what this template's own compose files configure, from
      // `__FORGE_NAME__-app`. A validation rule that rejected it would fail
      // every generated project on its first migration — and the rule
      // originally proposed for this task, which allowed no hyphen, did.
      process.env.APP_DB_ROLE = role;
      expect(requireAppRoleName()).toBe(role);
    },
  );
});
