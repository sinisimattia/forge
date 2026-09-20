import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { AuthIdentityRecord } from '../../identities/auth-identity-record.entity';
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
 *
 * ## What these guards do not catch
 *
 * A textual guard over SQL embedded in TypeScript cannot be made complete, and
 * saying which shapes get past these ones is more useful than implying none do.
 * A review attacked them with twelve variants; three got through. Two are
 * named here rather than patched, because a guard that grows a special case
 * per adversarial variant gets harder to read without getting meaningfully
 * harder to defeat. The third — a foreign key smuggled into `audit_entries`'s
 * own `CREATE TABLE` behind a leading `COMMENT ON …;` in the same `query()`
 * call — was closed rather than disclosed in round 3 of this file's review,
 * after an earlier version of this list named the wrong composed statement as
 * the open one; see `audit_entries is never given a foreign key › and no
 * migration creates it with a foreign key inside its own CREATE TABLE` for
 * what actually closes it and why. Quoting and schema-qualification of
 * `audit_entries` itself — `"audit_entries"`, `public.audit_entries` — are
 * closed too, in every guard that names the table (round 2).
 *
 * - **`IF EXISTS` / `IF NOT EXISTS`.** `DROP TABLE IF EXISTS audit_entries`
 *   and `CREATE TABLE IF NOT EXISTS audit_entries` are invisible to
 *   `audit_entries is created once and never rebuilt`, and that spelling is the
 *   ordinary way somebody writes a rebuild by hand.
 * - **SQL hoisted into a variable.** `sqlStatements` reads a literal at the
 *   call; `const sql = '…'; await queryRunner.query(sql)` yields nothing, so
 *   every "no statement does X" assertion passes over it.
 *
 * None of these is a way to weaken the database. They are ways to weaken this
 * file, and what stands behind it is D13: Task 19 runs the real statement
 * against the real Postgres, and its fault injections include the foreign-key
 * bypass. If a change to the audit table cannot be made obvious in the text,
 * that is a reason to be suspicious of the change, not of the test.
 */

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

/** A migration's source, by the filename fragment that identifies it. */
function migrationSource(fragment: string): string {
  const file = readdirSync(MIGRATIONS_DIR).find((name) => name.includes(fragment));
  if (file === undefined) throw new Error(`No migration matching ${fragment} in ${MIGRATIONS_DIR}`);
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
}

/** Every migration, as `[filename, source]`, in filename order. */
const allMigrations: readonly (readonly [string, string])[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.ts'))
  .sort()
  .map((name) => [name, readFileSync(join(MIGRATIONS_DIR, name), 'utf8')] as const);

/**
 * The SQL a migration actually runs, one string per statement.
 *
 * Whole-file `toContain` and a slice of one `CREATE TABLE` are both too narrow
 * for the thing that matters most here. A foreign key on `audit_entries` can be
 * written three ways — inside the create, by a later `ALTER TABLE … ADD
 * CONSTRAINT`, or by a relation decorator that `migration:generate` turns into
 * the second — and an assertion that reads only the create body cannot see the
 * other two. It was written that way, and a review injected the `ALTER TABLE`
 * form and watched the whole suite stay green while, at a real Postgres, the
 * application erased `actor_user_id` through a `DELETE` aimed at `users`.
 *
 * Per-statement is the granularity that fixes it: "no statement that names
 * `audit_entries` may also say `REFERENCES`" is true however the key is
 * written, and false the moment one exists.
 *
 * This reads the two shapes this backend's migrations use — a literal passed to
 * `queryRunner.query(...)`, and a `format()` template passed to a migration's
 * local `exec(queryRunner, ...)`. A third shape is invisible to it — see "What
 * these guards do not catch" at the top of this file.
 *
 * The `yields the SQL of %s` cases below are a weaker guard than that gap
 * needs, and it is worth being exact about which: each fires when its migration
 * yields *no* statements at all, so they catch the extractor being broken or a
 * whole migration written in a shape it cannot read. They do not fire on a
 * single unreadable statement inside a migration whose other statements read
 * fine, which is exactly what hoisting one query into a `const` produces.
 */
function sqlStatements(source: string): string[] {
  const call = /(?:queryRunner\.query|exec)\(\s*(?:queryRunner\s*,\s*)?(?:`([^`]*)`|'((?:[^'\\]|\\.)*)')/g;
  const statements: string[] = [];
  let match: RegExpExecArray | null = call.exec(source);
  while (match !== null) {
    statements.push(match[1] ?? match[2] ?? '');
    match = call.exec(source);
  }
  return statements;
}

/** Every statement of every migration, tagged with the file it came from. */
function allStatements(): (readonly [string, string])[] {
  return allMigrations.flatMap(([name, source]) =>
    sqlStatements(source).map((statement) => [name, statement] as const),
  );
}

/**
 * Those statements matching `pattern`, rendered for a failure message.
 *
 * Takes statements, never sources, and that signature is the fix for a bug this
 * function had on its first draft: it used to take `[name, source]` pairs and
 * call `sqlStatements` itself, so a caller that had already extracted and
 * filtered its statements handed it SQL where it expected TypeScript,
 * `sqlStatements` found no `query(` call in it, and the assertion passed
 * against an empty list. It was caught by an injected fault firing on a
 * different, blunter assertion than the one aimed at it.
 *
 * @param pattern - what a statement must not (or must) contain
 * @param statements - the statements to search; all of them by default
 * @returns one `filename: statement` line per match, whitespace collapsed
 */
function statementsMatching(
  pattern: RegExp,
  statements: readonly (readonly [string, string])[] = allStatements(),
): string[] {
  return statements
    .filter(([, statement]) => pattern.test(statement))
    .map(([name, statement]) => `${name}: ${statement.trim().replace(/\s+/g, ' ')}`);
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

  it('gives audit_entries no foreign key in its own CREATE TABLE', () => {
    // The whole-schema version of this — every statement, every migration, and
    // the record class — is in `audit_entries is never given a foreign key`
    // below. This one stays because it fails with the create body in the
    // message, which is the fastest thing to read when it breaks.
    expect(createTableBody('audit_entries')).not.toMatch(/REFERENCES/);
  });

  it('cascades refresh tokens from their session, and nulls out a replaced one', () => {
    const body = createTableBody('refresh_tokens');
    // Losing the first orphans refresh tokens past the revocation of the
    // session they belong to — credentials that outlive the thing that was
    // supposed to contain them.
    expect(body).toContain('REFERENCES sessions (id) ON DELETE CASCADE');
    // The second is a self-reference, and `SET NULL` rather than `CASCADE`
    // deliberately: deleting a spent token must not take the token that
    // replaced it with it.
    expect(body).toContain('REFERENCES refresh_tokens (id) ON DELETE SET NULL');
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

  it('makes one password identity per account a partial unique index', () => {
    // Two separate propositions, and the second is the one that is easy to lose.
    //
    // That the index EXISTS is what stops `findPasswordIdentityByUser` — a
    // `findOne` over `(user_id, provider)` — from answering with whichever of
    // two password rows the planner reached first.
    //
    // That it is PARTIAL is what stops it from being a different rule wearing
    // the same name. `UNIQUE (user_id, provider)` would enforce this and also
    // forbid an account from ever holding two identities from one non-password
    // provider, which nothing in this template has decided. The `WHERE` is the
    // whole difference and it is one clause somebody could drop while
    // "simplifying" the statement, so it is asserted in its own right.
    const statement = /CREATE UNIQUE INDEX uq_auth_identities_one_password_per_user\s+ON auth_identities \(user_id\)\s+WHERE provider = '([A-Z_]+)'/
      .exec(source);

    expect(statement).not.toBeNull();
    // And the predicate names the provider the application actually stores.
    // The migration writes `'PASSWORD'` as a literal on purpose — a migration
    // that read this enum at runtime would silently rewrite its own history
    // every time the member's value moved. This comparison is what turns that
    // divergence into a red test for a person to decide about, instead.
    expect(statement?.[1]).toBe(AuthProvider.PASSWORD);

    // `AuthIdentityRecord` mirrors the index in a decorator, for a reader who
    // has the class open rather than the migration. A mirror nobody compares is
    // how the two drift apart while both look considered, so this reads the
    // decorator back out of TypeORM's own metadata and holds it to the same
    // predicate. `synchronize` is off, so the decorator creates nothing — which
    // is exactly why its going wrong would otherwise be silent.
    const mirrored = getMetadataArgsStorage().indices.find(
      (index) => index.name === 'uq_auth_identities_one_password_per_user',
    );
    expect(mirrored?.target).toBe(AuthIdentityRecord);
    expect(mirrored?.unique).toBe(true);
    expect(mirrored?.where).toBe(`provider = '${AuthProvider.PASSWORD}'`);
    expect(mirrored?.columns).toEqual(['userId']);
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

  it('is a non-empty list — a guard on the `it.each` below, not coverage', () => {
    // `it.each([])` passes silently. Everything in this file that iterates
    // migrations would report green against a directory that had lost all of
    // them, so the list itself has to be asserted. Counted as plumbing, not as
    // one of the guarantees this suite protects.
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
    // Read from the statements, not the file. `AuditAppendOnly`'s TSDoc
    // explains what `ALTER DEFAULT PRIVILEGES` being standing configuration
    // means for anyone who rebuilds the audit table, and a whole-file match
    // counted that prose as a second migration setting them.
    const withDefaultPrivileges = sources
      .filter(([, source]) =>
        sqlStatements(source).some((statement) => statement.includes('ALTER DEFAULT PRIVILEGES')))
      .map(([name]) => name);
    expect(withDefaultPrivileges).toHaveLength(1);
    expect(withDefaultPrivileges[0]).toBe([...sources].map(([name]) => name).sort()[0]);
  });
});

describe('the statement extractor', () => {
  // Every assertion in the two blocks below is of the form "no statement does
  // X". All of them pass trivially if `sqlStatements` returns nothing — so the
  // extractor is asserted before anything is asserted with it. Without this,
  // renaming `exec` or wrapping a query in a helper would turn the audit-table
  // guarantees into assertions that cannot fail, which is the exact defect they
  // were written to repair.
  it.each(allMigrations)('yields the SQL of %s', (_name, source) => {
    expect(sqlStatements(source).length).toBeGreaterThan(0);
  });

  it('sees statement text, not just the call', () => {
    const statements = sqlStatements(migrationSource('IdentityFoundation')).join('\n');
    expect(statements).toContain('CREATE TABLE audit_entries');
    expect(statements).toContain('COMMENT ON COLUMN users.email IS');
  });

  it('sees an exec() template as well as a queryRunner.query() literal', () => {
    // The role and audit migrations put their SQL in `exec(queryRunner, ...)`;
    // only the schema migration calls `queryRunner.query` directly. An
    // extractor that read one shape would leave the other two unguarded.
    expect(sqlStatements(migrationSource('AuditAppendOnly')).join('\n'))
      .toContain('REVOKE UPDATE, DELETE ON audit_entries FROM %I');
    expect(sqlStatements(migrationSource('AppRoleAndDefaultPrivileges')).join('\n'))
      .toContain('ALTER DEFAULT PRIVILEGES');
  });
});

describe('audit_entries is never given a foreign key', () => {
  // This is D13's most likely quiet death. A foreign key's referential action
  // runs with the *table owner's* privileges, not the caller's, so `ON DELETE
  // CASCADE` deletes an audit row and `ON DELETE SET NULL` erases its actor —
  // both through a statement aimed at `users`, both straight past the REVOKE,
  // both demonstrated at a real Postgres. Nothing about the failure looks like
  // a privilege problem, so nothing points at this file.

  it('in any statement of any migration, however the key is written', () => {
    // `COMMENT ON` is excluded, and only `COMMENT ON`: the column comment this
    // schema ships says "Deliberately not a foreign key", and a `COMMENT ON`
    // statement cannot create a constraint, so nothing is given up by skipping
    // it. The exclusion is by the statement's *leading* keyword, so a statement
    // that opens `COMMENT ON` and then goes on to do something else is skipped
    // whole — the sibling assertion below is what covers that.
    const notComments = allStatements().filter(([, st]) => !/^\s*COMMENT ON\b/i.test(st));
    // The exclusion must not empty the haystack. Without this line the
    // assertion below passes for the wrong reason the moment anything upstream
    // stops producing statements, which is precisely how it failed before.
    expect(notComments.filter(([, st]) => /\baudit_entries\b/.test(st)).length)
      .toBeGreaterThanOrEqual(3);
    expect(statementsMatching(/\baudit_entries\b[\s\S]*?(?:REFERENCES|FOREIGN KEY)/i, notComments))
      .toEqual([]);
  });

  // Round 3 of this file's review found the gap the test above actually has:
  // not the `OWNER TO`-behind-`COMMENT ON` shape a since-corrected disclosure
  // named (that one is unanchored `.test()` over the *ALTER TABLE* allow-list
  // below, and a leading `COMMENT ON` does not hide anything from a scan of
  // the whole string), but `CREATE TABLE audit_entries (…)` itself carrying a
  // `REFERENCES` in its own column list, composed behind a leading
  // `COMMENT ON …;` in the same `query()` call:
  //
  //   COMMENT ON TABLE audit_entries IS 'x';
  //   CREATE TABLE audit_entries (id uuid, user_id uuid REFERENCES users(id));
  //
  // The test above cannot see this: its `COMMENT ON` exclusion is by the
  // statement's *leading* keyword, so a statement that opens `COMMENT ON` and
  // then goes on to create the table is skipped whole. The `ALTER TABLE`
  // allow-list does not apply — wrong keyword, this is a `CREATE`. The reverse
  // `REFERENCES audit_entries` guard does not apply either — wrong direction,
  // `audit_entries` is the FK's *source* here, not its target. And this
  // matters precisely because it is the CREATE, not the ALTER: a `REFERENCES
  // users(id)` smuggled into the table's own construction is exactly the
  // referential-action hazard `IdentityFoundation` refused for
  // `actor_user_id` — delete a user and the reference rewrites or erases an
  // audit row through a statement aimed at `users`, past the REVOKE.
  //
  // Closed rather than disclosed, because the fix is genuinely cheap and does
  // not touch the COMMENT exclusion above (which stays, for the reason its own
  // comment gives — the real `COMMENT ON COLUMN audit_entries…` this schema
  // ships literally contains the words "foreign key" in its prose, and
  // dropping that exclusion to reach this case would turn a legitimate comment
  // into a false positive). Anchored on the one substring no legitimate
  // comment contains — `CREATE TABLE audit_entries (` itself, however quoted
  // or schema-qualified — rather than on the statement's leading keyword, so a
  // `COMMENT ON` prefix has nothing to hide behind.
  it('and no migration creates it with a foreign key inside its own CREATE TABLE, whatever precedes the statement', () => {
    const createBody = /CREATE\s+TABLE\s+(?:public\.)?"?audit_entries"?\s*\(([\s\S]*)\)/i;
    const offenders = allStatements()
      .map(([name, statement]) => [name, createBody.exec(statement)?.[1]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .filter(([, body]) => /REFERENCES|FOREIGN KEY/i.test(body));
    expect(offenders).toEqual([]);
  });

  it('and AuditEntryRecord declares no relation for migration:generate to emit', () => {
    // The third route, and the one that does not look like SQL at all: a
    // `@ManyToOne` here produces nothing at runtime (`synchronize` is false),
    // but `npm run migration:generate` would dutifully write the `ALTER TABLE`
    // for it into a new migration, and that migration would be reviewed as
    // generated boilerplate.
    //
    // Anchored at the start of a line so the record class can go on *naming*
    // these decorators in the comment that warns against them.
    const record = readFileSync(
      join(__dirname, '..', '..', 'audit', 'audit-entry-record.entity.ts'),
      'utf8',
    );
    expect(record).toContain('@Entity(\'audit_entries\')');
    expect(record).not.toMatch(
      /^\s*@(?:ManyToOne|OneToOne|OneToMany|ManyToMany|JoinColumn|JoinTable)\s*\(/m,
    );
  });
});

describe('audit_entries permits exactly two ALTER TABLE statements, and nothing else structural', () => {
  // This guard was narrowed once, to "adds a constraint", to let Task 9's own
  // `ALTER TABLE audit_entries ALTER COLUMN organization_id TYPE uuid` through.
  // That narrowing was a defect, caught on review: it preserved every
  // foreign-key check intact and quietly let through the one statement that
  // voids D13 more completely than any foreign key does —
  // `ALTER TABLE audit_entries OWNER TO <app role>`. Table ownership is not
  // subject to the REVOKE at all; the owner can `GRANT` itself `UPDATE` and
  // `DELETE` straight back, no referential action required. The same
  // narrowing also newly allowed `DROP COLUMN`, `ALTER COLUMN … DROP NOT
  // NULL`, an unnamed `ADD CHECK`/`ADD UNIQUE`/`ADD PRIMARY KEY`, `RENAME TO`,
  // `INHERIT` and `ENABLE … RULE` — none of them caught by anything else in
  // this file.
  //
  // Restored to a blanket rule, allow-listing the exact statements this
  // schema needs rather than trying to name every dangerous shape an
  // `ALTER TABLE` can take. This is no more brittle than the narrowed regex
  // was: it changes only when somebody alters `audit_entries`, which is
  // exactly when a human must look — the maintenance cost of updating this
  // list on a genuine, reviewed change to the table IS the guard working, not
  // a tax on it.
  it('collects every ALTER TABLE audit_entries statement, whitespace-normalized, and checks it against the allow-list', () => {
    // `(?:public\.)?"?…"?` catches the quoted identifier (`"audit_entries"`)
    // and the unquoted schema-qualified form (`public.audit_entries`) — the
    // same two spellings the reverse `REFERENCES` guard below now catches.
    // Round 2 of review found these had diverged: the `REFERENCES` guard was
    // fixed to catch quoting in round 1 and this selector was not, so
    // `ALTER TABLE "audit_entries" OWNER TO app` — the exact statement this
    // whole describe block exists to stop — walked straight past it.
    const normalize = (sql: string): string => sql.trim().replace(/\s+/g, ' ');

    const found = allStatements()
      .filter(([, statement]) =>
        /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?"?audit_entries"?\b/i.test(statement))
      .map(([, statement]) => normalize(statement));

    // Exactly the two Task 9 needs: the up() cast to uuid and the down() cast
    // back to text. Anything else — an added constraint, a dropped column, an
    // OWNER TO, a whitespace variant this normalization does not collapse the
    // same way — is not on this list, and the assertion below is red for it.
    const PERMITTED = [
      'ALTER TABLE audit_entries ALTER COLUMN organization_id TYPE uuid USING organization_id::uuid',
      'ALTER TABLE audit_entries ALTER COLUMN organization_id TYPE text USING organization_id::text',
    ];
    expect([...found].sort()).toEqual([...PERMITTED].sort());
  });
});

describe('the organizations-and-authorization migration', () => {
  // The guarantee this protects is not a property of `audit_entries` alone: it
  // is a property of every foreign key anyone ever adds to it. So the assertion
  // is over the whole migration directory, not over one file, and it is written
  // as "no statement anywhere references audit_entries in a REFERENCES clause"
  // rather than as a check of the one migration that creates it.
  //
  // This is the reverse direction from `audit_entries is never given a foreign
  // key` above: that block catches `audit_entries` declaring a FK to something
  // else (`audit_entries`, then later, `REFERENCES`); this one catches some
  // *other* table declaring a FK that points AT `audit_entries` (`REFERENCES
  // audit_entries`), which the word-order-sensitive regex above does not see
  // when nothing else in the same statement mentions `audit_entries` first.
  it('adds no foreign key to audit_entries, in any migration', () => {
    // `(?:public\.)?"?…"?` catches both the quoted identifier form,
    // `REFERENCES "audit_entries"`, and the unquoted schema-qualified form,
    // `REFERENCES public.audit_entries` — the same two spellings the
    // `ALTER TABLE` guard above now catches, for the same reason: quoting one
    // guard and not the other is how this exact bypass slipped through once
    // already. A composed statement — a foreign key or an `OWNER TO`
    // concatenated after a leading `COMMENT ON …;` inside one `query()` call —
    // remains a disclosed gap; see "What these guards do not catch" at the
    // top of this file.
    const offenders = allMigrations
      .flatMap(([, source]) => sqlStatements(source))
      .filter((sql) => /REFERENCES\s+(?:public\.)?"?audit_entries"?/i.test(sql));
    expect(offenders).toEqual([]);
  });

  it.each([
    'uq_organizations_slug',
    'uq_memberships_org_user',
    'uq_organization_invitations_token_hash',
  ])('creates the four Phase 3 tables with the uniqueness constraint %s', (constraint) => {
    // `expect(actual, message)` is not a Jest signature — Jest's `expect` takes
    // one argument, unlike Jasmine/Chai's. `it.each` is what gets the failing
    // constraint's name into the test's own title instead.
    //
    // `statementsMatching` takes STATEMENTS, never sources — and, less
    // obviously, never a plain `string[]` of statements either: its signature
    // is `readonly (readonly [string, string])[]`, `[filename, statement]`
    // pairs, because `[, statement]` destructuring a bare string treats the
    // string itself as the array and silently reads its second *character*.
    // `sqlStatements` alone returns `string[]`, so it is tagged with the
    // filename here the same way `inUp` is tagged in `audit_entries is created
    // once and never rebuilt` above.
    const name = '1758000003000-OrganizationsAndAuthorization.ts';
    const statements = sqlStatements(migrationSource('OrganizationsAndAuthorization'))
      .map((statement) => [name, statement] as const);
    expect(statementsMatching(new RegExp(constraint), statements)).toHaveLength(1);
  });
});

describe('the default privileges grant exactly four privileges', () => {
  const source = migrationSource('AppRoleAndDefaultPrivileges');

  it('on tables', () => {
    // The list is load-bearing and nothing else asserted it. Adding one word,
    // `TRUNCATE`, lets the application empty the entire audit log in a single
    // statement with the REVOKE still in place — demonstrated at a real
    // Postgres, with the suite green.
    expect(upBody(source)).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I');
  });

  it('on sequences', () => {
    expect(upBody(source)).toContain('GRANT USAGE, SELECT ON SEQUENCES TO %I');
  });

  it('and no migration grants TRUNCATE to anything', () => {
    // Asserted on the statements rather than the file: `AuditAppendOnly`'s
    // TSDoc legitimately explains why TRUNCATE is absent, and a rule that
    // forbade the word outright would forbid saying so.
    expect(statementsMatching(/TRUNCATE/i)).toEqual([]);
  });
});

describe('audit_entries is created once and never rebuilt', () => {
  // `ALTER DEFAULT PRIVILEGES` is standing configuration, not a one-time act.
  // Anything the owner creates in `public` from here on carries all four
  // privileges for the application role — so a later migration that drops and
  // re-creates this table hands UPDATE and DELETE straight back, silently.
  // Verified at a real Postgres. The REVOKE applies to the table that existed
  // when it ran and to no other.
  //
  // `CREATE TABLE audit_entries` and `DROP TABLE audit_entries` are matched as
  // written, so the `IF NOT EXISTS` / `IF EXISTS` spelling of a rebuild is not
  // caught — see "What these guards do not catch" at the top of this file, and
  // the warning in `AuditAppendOnly`'s TSDoc, which is where somebody about to
  // rebuild the table is actually reading.

  const creators = allMigrations.filter(
    ([, source]) => sqlStatements(source).some((s) => /CREATE TABLE audit_entries\b/.test(s)),
  );

  it('is created by exactly one migration', () => {
    expect(creators.map(([name]) => name)).toHaveLength(1);
  });

  it('is dropped by no other migration, and only in that one\'s down()', () => {
    const [creatorName, creatorSource] = creators[0];
    const elsewhere = allStatements().filter(([name]) => name !== creatorName);
    expect(statementsMatching(/DROP TABLE audit_entries\b/, elsewhere)).toEqual([]);

    const inUp = sqlStatements(upBody(creatorSource)).map((st) => [creatorName, st] as const);
    expect(inUp.length).toBeGreaterThan(0);
    expect(statementsMatching(/DROP TABLE audit_entries\b/, inUp)).toEqual([]);
    // ...and it really is dropped, in down(). Otherwise "not in up()" is true
    // of a migration that never drops it at all.
    expect(statementsMatching(/DROP TABLE audit_entries\b/, allStatements())).toHaveLength(1);
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
      // The compose files name this role after the project with an `-app`
      // suffix, so a hyphen is in it whenever the project name has one: a
      // project called `my-app` gets `my-app-app`, one called `blog` gets
      // `blog-app`. A validation rule that rejected the first would fail every
      // generated project whose name has a hyphen, on its first migration —
      // and the rule originally proposed for this task, which allowed no
      // hyphen, did.
      process.env.APP_DB_ROLE = role;
      expect(requireAppRoleName()).toBe(role);
    },
  );
});
