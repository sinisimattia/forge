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
 * ## One canonical spelling, because chasing spellings does not converge
 *
 * Four rounds of review each found a different *spelling* of the same table
 * reference walking past a guard that named it: the quoted identifier
 * `"audit_entries"`; the schema-qualified `public.audit_entries`; a
 * `CREATE TABLE audit_entries (… REFERENCES …)` hidden behind a leading
 * `COMMENT ON …;` in one `query()` call; and then the same thing again spelled
 * `CREATE TABLE IF NOT EXISTS`. Each round closed one spelling in one guard,
 * and each was followed by the discovery of another. That is not four
 * oversights, it is one design error: a guard written against raw SQL text
 * makes every way of writing a table reference a separate bypass, and the
 * supply of spellings is not finite.
 *
 * So no guard below reads raw SQL. `canonicalStatements` reduces a `query()`
 * argument to a canonical form first, and every guard is written against that
 * one form — which is why a fifth spelling closes itself rather than becoming
 * a fifth round. What canonicalization does, and each of the bypasses it
 * retires, is documented on `canonicalize` itself.
 *
 * The normalizer is the single point of failure this buys: a bug in it
 * weakens every guard at once, silently. That is not hypothetical — it
 * happened, in round 5, and the shape is worth keeping in view. The lexer had
 * no branch for Postgres dollar-quoting, so a `DO $do$ … $do$` body containing
 * an odd number of apostrophes put the single-quote branch into a literal that
 * ran to the end of the `query()` argument. Whatever followed the block was
 * never lower-cased and never split at `;`, and five guards reported clean on
 * an empty corpus. The raw-text regex this canonical form replaced had matched
 * it. Two things answer that. It is tested
 * in its own right — `the canonical form of a statement` asserts that each
 * spelling reduces to the *same* canonical string, so a normalizer that
 * stopped collapsing something fails there rather than quietly widening four
 * guards. And `the guards refuse every spelling that voids D13` runs the
 * guard predicates against a constructed offender in every spelling, so
 * "refuses" is a property this suite checks rather than one a reader infers
 * from a regex.
 *
 * Canonicalization deliberately does **not** erase what a guard needs to see.
 * String literals survive verbatim, which is why `audit_entries is never given
 * a foreign key` still has to exclude statements that open `COMMENT ON`: the
 * column comment this schema ships says, in prose, "Deliberately not a foreign
 * key", and a guard scanning that text would fire on the comment explaining
 * why there is no foreign key. Its sibling, the `CREATE TABLE` check, must not
 * take the same exclusion — it is anchored on structure rather than on a
 * leading keyword, precisely so that a `COMMENT ON` prefix has nothing to hide
 * behind. Two guards over one table, opposite treatment of the same prefix,
 * both deliberate.
 *
 * ## What these guards do not catch
 *
 * A textual guard over SQL embedded in TypeScript still cannot be made
 * complete, and saying which shapes get past these ones is more useful than
 * implying none do. Each bullet below was constructed and confirmed open
 * before being written here, because this list has been wrong three times —
 * once naming a case that was already covered, once omitting one that was
 * live, and once (round 5) omitting a regression the canonical form itself had
 * introduced, because nobody had thought to ask which of SQL's lexical
 * constructs the lexer actually knew about. The answer to that last question
 * is now written out on `canonicalize`, construct by construct, and each one
 * is pinned by a test.
 *
 * Both bullets are about the *extractor's reach*, not the guards: the
 * statement never reaches a guard as text. Anything that does reach one — any
 * spelling of any statement — is the canonical form's problem, and that is
 * where the effort goes.
 *
 * - **SQL that is not a literal at the call.** `sqlStatements` reads the
 *   string written at `queryRunner.query(…)` / `exec(queryRunner, …)`. A
 *   hoisted `const sql = '…'; await queryRunner.query(sql)` yields nothing at
 *   all; `'ALTER TABLE ' + table + ' OWNER TO app'` yields only the first
 *   fragment; a `${}` interpolation of a variable yields text with the
 *   variable's name in it where the table's name should be. All three pass
 *   every "no statement does X" assertion in this file.
 * - **Schema changes made through TypeORM's QueryRunner API rather than SQL.**
 *   `queryRunner.createForeignKey('audit_entries', …)` adds exactly the
 *   foreign key this file exists to forbid, and leaves no SQL text anywhere
 *   for a guard to read. The migrations here use `query()` and `exec()`
 *   throughout; nothing in the type system requires the next one to.
 *
 * Neither is a way to weaken the database that a reviewer reading the
 * migration could not see, and what stands behind all of it is D13: Task 19
 * runs the real statement against the real Postgres, and its fault injections
 * include the foreign-key bypass. If a change to the audit table cannot be
 * made obvious in the text, that is a reason to be suspicious of the change,
 * not of the test.
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
 * This reads the shapes this backend's migrations use — a literal passed to
 * `queryRunner.query(...)`, and a `format()` template passed to a migration's
 * local `exec(queryRunner, ...)` — in all three of TypeScript's string
 * delimiters. The double-quoted form reads nothing today, because this
 * codebase writes single quotes; it is here because a round of review injected
 * a fault in a double-quoted argument and the suite stayed green for a reason
 * that had nothing to do with the guard under test. An extractor that reads
 * two of the three delimiters is a bypass in its own right, and a silent one:
 * the injected statement is not refused, it is simply never seen.
 *
 * A shape that remains invisible — SQL that is not a literal at the call at
 * all — is disclosed at the top of this file.
 *
 * The `yields the SQL of %s` cases below are a weaker guard than that gap
 * needs, and it is worth being exact about which: each fires when its migration
 * yields *no* statements at all, so they catch the extractor being broken or a
 * whole migration written in a shape it cannot read. They do not fire on a
 * single unreadable statement inside a migration whose other statements read
 * fine, which is exactly what hoisting one query into a `const` produces.
 */
function sqlStatements(source: string): string[] {
  const call = /(?:queryRunner\.query|exec)\(\s*(?:queryRunner\s*,\s*)?(?:`([^`]*)`|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  const statements: string[] = [];
  let match: RegExpExecArray | null = call.exec(source);
  while (match !== null) {
    statements.push(match[1] ?? match[2] ?? match[3] ?? '');
    match = call.exec(source);
  }
  return statements;
}

/**
 * The index just past the single-quoted literal starting at `at`, or -1 when
 * that literal is never closed.
 *
 * Returning -1 rather than "the end of the argument" is the whole point. An
 * unterminated literal is not valid SQL — Postgres refuses the statement — so
 * the only question is what the *guards* should be able to see, and the answer
 * is everything. Swallowing the remainder would hide whatever followed the
 * stray apostrophe from every guard at once; leaving it as ordinary text can
 * at worst produce a noisy failure on SQL that could never have run.
 *
 * @param raw - the argument being scanned
 * @param at - the index of the opening apostrophe
 * @returns the index just past the closing apostrophe, or -1
 */
function endOfStringLiteral(raw: string, at: number): number {
  let end = at + 1;
  while (end < raw.length) {
    if (raw[end] === '\'' && raw[end + 1] === '\'') {
      end += 2;
      continue;
    }
    if (raw[end] === '\'') return end + 1;
    end += 1;
  }
  return -1;
}

/**
 * The index just past the dollar-quoted literal starting at `at`, or -1 when
 * `at` does not open one or it is never closed.
 *
 * `$tag$ … $tag$`, where the tag may be empty (`$$ … $$`) and the body is
 * opaque: no escape processing happens inside it, and it ends only at the
 * exact matching tag. A *different* tag within the body is ordinary text, so
 * this does not recurse — it finds the matching close and stops.
 *
 * This branch is here because its absence was a regression, found in round 5
 * of this file's review. The guard this file's canonical form replaced ran a
 * regex over raw statement text and matched straight through a dollar-quoted
 * body; the lexer did not, so a body containing an odd number of apostrophes
 * —
 *
 *   DO $do$ BEGIN RAISE NOTICE $m$it's fine$m$; END $do$; ALTER TABLE …
 *
 * — put the single-quote branch into a literal that ran to the end of the
 * argument. Whatever followed was never lower-cased and never split at `;`,
 * so five guards read an empty corpus and reported clean. That is the risk
 * of one lexer under every guard, arriving: the failure is not one guard
 * being lenient, it is all of them being blind at once.
 *
 * There is an irony in the construct. `AppRoleAndDefaultPrivileges` used to
 * wrap its `CREATE ROLE` in a `DO $do$ … $do$` block and that block was
 * deleted, because a password containing the literal text `$do$` broke out of
 * it — demonstrated by dropping a canary table. Two phases later the same
 * construct reappeared as a blind spot in the guard protecting that same
 * table, from the other direction.
 *
 * @param raw - the argument being scanned
 * @param at - the index that may open a dollar quote
 * @returns the index just past the closing tag, or -1
 */
function endOfDollarLiteral(raw: string, at: number): number {
  if (raw[at] !== '$') return -1;
  let tagEnd = at + 1;
  while (tagEnd < raw.length && /[A-Za-z0-9_]/.test(raw[tagEnd])) tagEnd += 1;
  if (raw[tagEnd] !== '$') return -1;
  // A tag follows the rules for an unquoted identifier, so it cannot begin
  // with a digit: `$1$` is the bind parameter `$1` followed by a `$`, not an
  // opener. Reading it as one would swallow everything up to the next `$1$`,
  // which is a way to hide a statement rather than a way to write one.
  if (/^\$[0-9]/.test(raw.slice(at, tagEnd + 1))) return -1;
  const tag = raw.slice(at, tagEnd + 1);
  const close = raw.indexOf(tag, tagEnd + 1);
  return close === -1 ? -1 : close + tag.length;
}

/**
 * The statements of one `query()` argument, each in the single spelling every
 * guard in this file is written against.
 *
 * ## What it does, and which bypass each part retires
 *
 * - **SQL comments are stripped** — `-- …` to end of line, and slash-star block
 *   comments, nested ones included. An `ALTER TABLE` with a block comment
 *   between the keyword and the table name is otherwise a table reference no
 *   `ALTER\s+TABLE\s+audit_entries` regex can see.
 * - **String literals are lifted out and put back verbatim**, `''` escapes
 *   included. Nothing below rewrites prose — which matters because the
 *   `COMMENT ON COLUMN audit_entries.actor_user_id` this schema ships contains
 *   the words "foreign key", and the guard that must not fire on it relies on
 *   reading its real leading keyword.
 * - **Dollar-quoted bodies are lifted out the same way**, `$$ … $$` and
 *   `$tag$ … $tag$` alike, before comments are stripped and before the split
 *   at `;`. A body with an odd number of apostrophes in it otherwise runs the
 *   single-quote branch off the end of the argument and takes every statement
 *   after it out of view — the regression `endOfDollarLiteral` exists to fix,
 *   and the sharpest illustration of what one shared lexer costs when it is
 *   wrong.
 * - **An unterminated literal, of either kind, is not treated as a literal at
 *   all.** Its opening character becomes ordinary text and scanning carries
 *   on, so nothing after it is hidden. Such a statement is not valid SQL and
 *   Postgres would refuse it, so the choice is only about what the guards can
 *   see, and more is the safe answer.
 * - **Quoted identifiers are unquoted and folded**, so `"audit_entries"`,
 *   `"AUDIT_ENTRIES"` and `audit_entries` are one name (rounds 1–2).
 * - **Everything outside a literal is lower-cased**, so no guard needs an `i`
 *   flag and none can be defeated by case. Guards are therefore written in
 *   lower case, and a keyword appearing *inside* a literal is deliberately not
 *   matched by them.
 * - **`IF NOT EXISTS` / `IF EXISTS` are elided**, which is what round 4 was
 *   opened for, and which also retires the rebuild spelling this file used to
 *   disclose as an open gap in `audit_entries is created once and never
 *   rebuilt`.
 * - **`ONLY` after `ALTER TABLE`, and `TEMP`/`TEMPORARY`/`UNLOGGED`/`GLOBAL`/
 *   `LOCAL` inside `CREATE … TABLE`, are elided.** The second was never
 *   reported by a reviewer; it is the fifth spelling, and it costs nothing
 *   here because the canonical form is where spellings go to die.
 * - **`public.` is dropped, and so is any other schema qualifier written on
 *   `audit_entries`** (round 2 closed `public.`; a different schema name is
 *   the same move). `audit_entries.actor_user_id` is untouched — there the
 *   table is the qualifier, not the qualified.
 * - **Whitespace, commas and parentheses are regularized**, so `ALTER   TABLE`
 *   across a line break and `users(id)` versus `users (id)` are one string.
 * - **The argument is split at `;`**, outside literals, into the statements it
 *   really is. A composed `COMMENT ON …; ALTER TABLE audit_entries OWNER TO
 *   app` is two statements here, so the second is examined on its own merits
 *   instead of hiding behind the first's leading keyword (round 3's finding,
 *   closed generally rather than per-guard).
 *
 * `@@0@@`-style sentinels stand in for literals while the rewrites run. Real
 * SQL that contained the text `@@` followed by digits followed by `@@` would
 * be misread; nothing writes that, and the alternative — rewriting inside
 * prose — is the failure mode that actually bites.
 *
 * @param raw - one `query()` argument, as written
 * @returns its statements, canonical, in order, with empties dropped
 */
function canonicalize(raw: string): string[] {
  const literals: string[] = [];
  let text = '';
  let index = 0;

  const lift = (end: number): void => {
    literals.push(raw.slice(index, end));
    text += `@@${literals.length - 1}@@`;
    index = end;
  };

  while (index < raw.length) {
    const here = raw[index];
    const next = raw[index + 1];

    const dollar = endOfDollarLiteral(raw, index);
    if (dollar !== -1) {
      lift(dollar);
      continue;
    }

    if (here === '\'') {
      const end = endOfStringLiteral(raw, index);
      if (end !== -1) {
        lift(end);
        continue;
      }
      // Unterminated. Falls through to ordinary text on purpose — see the
      // TSDoc above for why that is the safe direction.
    }

    if (here === '"') {
      let end = index + 1;
      let identifier = '';
      while (end < raw.length) {
        if (raw[end] === '"' && raw[end + 1] === '"') {
          identifier += '"';
          end += 2;
          continue;
        }
        if (raw[end] === '"') {
          end += 1;
          break;
        }
        identifier += raw[end];
        end += 1;
      }
      if (text.endsWith('u&')) {
        // `U&"…"` is a Unicode-escaped identifier: what is between the quotes
        // is an escape sequence, not a name, so `U&"\0061udit_entries"` names
        // `audit_entries` and canonicalizing it would mean decoding — with an
        // escape character that a trailing `UESCAPE 'x'` clause can itself
        // redefine. This does not decode it. It marks it, and
        // `no migration writes a Unicode-escaped identifier` refuses the whole
        // construct, which is complete without understanding any of it.
        //
        // Matched only where the `&` abuts the quote, because that is the only
        // place Postgres accepts it: `U& "audit_entries"` with a space is not
        // this syntax and not any other, it is a syntax error, so it is not a
        // spelling of anything.
        text = `${text.slice(0, -2)}unicode_escaped_identifier`;
      } else {
        text += identifier.toLowerCase();
      }
      index = end;
      continue;
    }

    if (here === '-' && next === '-') {
      const newline = raw.indexOf('\n', index);
      index = newline === -1 ? raw.length : newline;
      text += ' ';
      continue;
    }

    if (here === '/' && next === '*') {
      let depth = 1;
      let end = index + 2;
      while (end < raw.length && depth > 0) {
        if (raw[end] === '/' && raw[end + 1] === '*') {
          depth += 1;
          end += 2;
          continue;
        }
        if (raw[end] === '*' && raw[end + 1] === '/') {
          depth -= 1;
          end += 2;
          continue;
        }
        end += 1;
      }
      index = end;
      text += ' ';
      continue;
    }

    text += here.toLowerCase();
    index += 1;
  }

  const folded = text
    .replace(/\s*\(\s*/g, ' ( ')
    .replace(/\s*\)\s*/g, ' ) ')
    .replace(/\s*,\s*/g, ' , ')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\bif\s+not\s+exists\b/g, ' ')
    .replace(/\bif\s+exists\b/g, ' ')
    .replace(
      /\bcreate\s+(?:global\s+|local\s+)?(?:temp\s+|temporary\s+|unlogged\s+)?table\b/g,
      'create table',
    )
    .replace(/\balter\s+table\s+only\b/g, 'alter table')
    .replace(/\bpublic\./g, '')
    .replace(/\b[a-z_][a-z0-9_$]*\.audit_entries\b/g, 'audit_entries')
    .replace(/\s+/g, ' ');

  return folded
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) =>
      statement.replace(/@@(\d+)@@/g, (_all, slot: string) => literals[Number(slot)]),
    );
}

/** Every canonical statement of one migration source. */
function canonicalStatements(source: string): string[] {
  return sqlStatements(source).flatMap(canonicalize);
}

/** Every canonical statement of every migration, tagged with its file. */
function allCanonicalStatements(): (readonly [string, string])[] {
  return allMigrations.flatMap(([name, source]) =>
    canonicalStatements(source).map((statement) => [name, statement] as const),
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
 * The default corpus is the *canonical* statements, not the raw ones, so a
 * caller that passes only a pattern gets the spelling-independent behaviour
 * without having to remember to ask for it. Patterns are therefore written in
 * lower case.
 *
 * @param pattern - what a statement must not (or must) contain
 * @param statements - the statements to search; every canonical one by default
 * @returns one `filename: statement` line per match, whitespace collapsed
 */
function statementsMatching(
  pattern: RegExp,
  statements: readonly (readonly [string, string])[] = allCanonicalStatements(),
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

/** A canonical statement, tagged with the migration it came from. */
type Tagged = readonly [string, string];

/**
 * Every `ALTER TABLE audit_entries` this schema is allowed to contain, canonical.
 *
 * An allow-list rather than a list of forbidden shapes, because the forbidden
 * shapes cannot be enumerated: `OWNER TO`, `DROP COLUMN`, `DISABLE TRIGGER`,
 * `ALTER COLUMN … DROP NOT NULL`, an unnamed `ADD CHECK`/`ADD UNIQUE`/`ADD
 * PRIMARY KEY`, `RENAME TO`, `INHERIT`, `ENABLE … RULE` — and that list was
 * already incomplete when it was written. Two of them are permitted, so two
 * of them are listed.
 *
 * Needing to edit this list is the guard working. It changes only when
 * somebody alters `audit_entries`, which is exactly the moment a human has to
 * look at what they are doing to the append-only guarantee.
 */
const PERMITTED_ALTERS = [
  'alter table audit_entries alter column organization_id type uuid using organization_id::uuid',
  'alter table audit_entries alter column organization_id type text using organization_id::text',
];

/**
 * Every privilege-granting statement over `audit_entries` this schema is
 * allowed to contain, canonical.
 *
 * Exactly one: the audit migration's `down()`, which hands both privileges
 * back because that is what reverting a revoke *is*. Anything else, in any
 * migration, in either direction, is the append-only guarantee being undone.
 */
const PERMITTED_GRANTS = ['grant update , delete on audit_entries to %i'];

/**
 * The guards over `audit_entries`, as predicates.
 *
 * They are functions rather than expressions inlined into their `it` bodies
 * for one reason: a guard that is only ever run against the real migrations is
 * a guard nobody has watched refuse anything. Written this way, each one is
 * run twice — once over the real corpus, where it must find nothing, and once
 * over a constructed corpus in `the guards refuse every spelling that voids
 * D13`, where it must find exactly the offender. A regex that stopped matching
 * would still pass the first run, and only the second is able to say so.
 *
 * All six take *canonical* statements. Passing raw SQL to any of them is the
 * mistake this file has made four times, and the lower-case patterns below are
 * what makes it fail loudly rather than silently: raw SQL is upper case here.
 */

/**
 * Statements that name `audit_entries` and also declare a foreign key.
 *
 * `comment on` is excluded, and only `comment on`. The exclusion is
 * load-bearing and must stay: the `COMMENT ON COLUMN
 * audit_entries.actor_user_id` this schema ships says, in its prose,
 * "Deliberately not a foreign key", and canonicalization preserves literals
 * verbatim, so without the exclusion this predicate fires on the comment that
 * explains why there is no foreign key. A `COMMENT ON` cannot create a
 * constraint, so nothing is given up.
 *
 * What *was* given up before, and no longer is: the exclusion reads the
 * statement's leading keyword, and a `query()` argument that opened
 * `COMMENT ON …;` and went on to do something else used to be skipped whole.
 * Canonicalization splits at `;` first, so the something-else is now its own
 * statement with its own leading keyword.
 */
function foreignKeyOffenders(statements: readonly Tagged[]): string[] {
  const notComments = statements.filter(([, sql]) => !/^comment on\b/.test(sql));
  return statementsMatching(
    /\baudit_entries\b[\s\S]*?\b(?:references|foreign key)\b/,
    notComments,
  );
}

/**
 * The haystack `foreignKeyOffenders` searches — everything it could possibly
 * report on.
 *
 * Its own function because it is asserted twice: the guard checks that this is
 * not empty before believing "no offenders", and the non-vacuity block checks
 * that the check is the thing that fails when it is. Written out twice, the
 * two would drift, and the drift would be invisible in exactly the case both
 * exist for.
 */
function auditNamingStatements(statements: readonly Tagged[]): string[] {
  return statements
    .filter(([, sql]) => /\baudit_entries\b/.test(sql) && !/^comment on\b/.test(sql))
    .map(([, sql]) => sql);
}

/** The column list of every `create table audit_entries ( … )`, wherever it sits. */
function auditCreateBodies(statements: readonly Tagged[]): string[] {
  const body = /\bcreate table audit_entries\s*\(([\s\S]*)\)/;
  return statements
    .map(([, sql]) => body.exec(sql)?.[1])
    .filter((found): found is string => found !== undefined);
}

/**
 * `create table audit_entries` bodies carrying a foreign key.
 *
 * Anchored on structure — the `create table audit_entries (` itself — and
 * emphatically *not* on the statement's leading keyword, which is the opposite
 * of what `foreignKeyOffenders` needs. That asymmetry is deliberate. The
 * comment exclusion protects prose; this one must have nothing a prefix can
 * hide behind, so that it keeps working even if the `;` split were ever to
 * stop splitting. Two guards over the same table, opposite treatment of the
 * same prefix, and flattening them is how round 3's bypass existed.
 */
function createTableForeignKeyOffenders(statements: readonly Tagged[]): string[] {
  return auditCreateBodies(statements).filter((body) =>
    /\b(?:references|foreign key)\b/.test(body),
  );
}

/** Every statement that alters `audit_entries`, for the allow-list to judge. */
function alterTableStatements(statements: readonly Tagged[]): string[] {
  return statements
    .filter(([, sql]) => /\balter table audit_entries\b/.test(sql))
    .map(([, sql]) => sql);
}

/** Statements declaring a foreign key that points AT `audit_entries`. */
function referencesAuditOffenders(statements: readonly Tagged[]): string[] {
  return statementsMatching(/\breferences\s+audit_entries\b/, statements);
}

/**
 * Every statement that hands table privileges back, for the allow-list to judge.
 *
 * `REVOKE UPDATE, DELETE ON audit_entries` is undone by naming the table again
 * — which the `ALTER TABLE` allow-list would catch — and also by never naming
 * it: `GRANT UPDATE ON ALL TABLES IN SCHEMA public TO <app role>` in any later
 * migration restores both privileges on every table that exists, audit log
 * included, and nothing else in this file reads it. `ALTER DEFAULT PRIVILEGES
 * … GRANT …` is not collected here — it leads with `alter`, it governs objects
 * created *after* it rather than the audit table, and `every migration › sets
 * the default privileges in the earliest migration of all` is what holds it to
 * one migration.
 */
function grantStatements(statements: readonly Tagged[]): string[] {
  return statements
    .filter(([, sql]) => /^grant\b/.test(sql))
    .filter(([, sql]) => /\baudit_entries\b|\ball tables in schema\b/.test(sql))
    .map(([, sql]) => sql);
}

/**
 * Statements that change ownership wholesale, without naming a table.
 *
 * The `ALTER TABLE` allow-list cannot see these: `REASSIGN OWNED BY owner TO
 * <app role>` and `ALTER TABLE ALL IN TABLESPACE … OWNER TO <app role>` hand
 * the application ownership of `audit_entries` while naming neither
 * `audit_entries` nor a single table, and an owner is not subject to the
 * REVOKE at all.
 */
function wholesaleOwnershipStatements(statements: readonly Tagged[]): string[] {
  return statementsMatching(/\breassign owned\b|\ball in tablespace\b/, statements);
}

/**
 * Statements naming a table through a Unicode-escaped identifier.
 *
 * `ALTER TABLE U&"\0061udit_entries" OWNER TO app` names `audit_entries` and
 * matches no guard here, because the canonical form cannot fold an escape
 * sequence into the name it denotes without decoding it — and the escape
 * character is redefinable by a `UESCAPE` clause, so a decoder would be a
 * second lexer with a second set of blind spots. Refusing the construct
 * outright is complete without decoding anything, and costs nothing: this
 * schema writes plain identifiers, and a Unicode-escaped one in a migration is
 * either a mistake or an attempt to spell a table name past a text guard.
 * Either way a person should look at it.
 *
 * Found while auditing the lexer in round 5. It is not the dollar-quote
 * regression and was never covered — rounds 1–3's `"?audit_entries"?` regexes
 * missed it too.
 */
function unicodeEscapedIdentifiers(statements: readonly Tagged[]): string[] {
  return statementsMatching(/\bunicode_escaped_identifier\b/, statements);
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

  it('reads all three of TypeScript\'s string delimiters', () => {
    // The double-quoted case reads nothing in this codebase today. It is
    // asserted because a round of review injected a fault in a double-quoted
    // argument, watched the suite stay green, and nearly concluded the guard
    // under test was sound: an extractor that reads two delimiters out of
    // three does not refuse the third, it never sees it.
    expect(sqlStatements('await queryRunner.query(`backtick`);')).toEqual(['backtick']);
    expect(sqlStatements('await queryRunner.query(\'single\');')).toEqual(['single']);
    expect(sqlStatements('await queryRunner.query("double");')).toEqual(['double']);
    expect(sqlStatements('await exec(queryRunner, "double, via exec");'))
      .toEqual(['double, via exec']);
  });
});

describe('the canonical form of a statement', () => {
  // The normalizer is the single component every guard below depends on, so a
  // bug in it weakens all of them at once and in silence. These tests are what
  // make that loud instead: each group asserts that a set of spellings reduces
  // to ONE canonical string, by name, so a rewrite that stopped collapsing
  // something fails here rather than by four guards quietly starting to agree
  // with an attacker.

  const OWNER_TO = 'alter table audit_entries owner to app';

  it.each([
    ['as written', 'ALTER TABLE audit_entries OWNER TO app'],
    ['lower case', 'alter table audit_entries owner to app'],
    ['mixed case', 'Alter Table Audit_Entries Owner To app'],
    ['double spaces', 'ALTER  TABLE   audit_entries    OWNER  TO  app'],
    ['line breaks', 'ALTER TABLE\n  audit_entries\n  OWNER TO app'],
    ['tabs', 'ALTER\tTABLE\taudit_entries\tOWNER\tTO\tapp'],
    ['ONLY', 'ALTER TABLE ONLY audit_entries OWNER TO app'],
    ['schema-qualified', 'ALTER TABLE public.audit_entries OWNER TO app'],
    ['a schema that is not public', 'ALTER TABLE archive.audit_entries OWNER TO app'],
    ['quoted', 'ALTER TABLE "audit_entries" OWNER TO app'],
    ['quoted and case-shifted', 'ALTER TABLE "AUDIT_ENTRIES" OWNER TO app'],
    ['qualified with a quoted name', 'ALTER TABLE public."audit_entries" OWNER TO app'],
    ['both halves quoted', 'ALTER TABLE "public"."audit_entries" OWNER TO app'],
    ['a spaced qualifier', 'ALTER TABLE public . audit_entries OWNER TO app'],
    ['all of them at once', 'ALTER  TABLE  ONLY\n  "public" . "AUDIT_ENTRIES"  OWNER  TO  app'],
    ['a line comment in the middle', 'ALTER TABLE -- nothing to see\n audit_entries OWNER TO app'],
    ['a block comment in the middle', 'ALTER TABLE /* nothing to see */ audit_entries OWNER TO app'],
    ['a nested block comment', 'ALTER TABLE /* a /* b */ c */ audit_entries OWNER TO app'],
    ['a trailing semicolon', 'ALTER TABLE audit_entries OWNER TO app;'],
  ])('reduces the %s spelling of an OWNER TO to one string', (_label, sql) => {
    expect(canonicalize(sql)).toEqual([OWNER_TO]);
  });

  const CREATE_WITH_FK
    = 'create table audit_entries ( id uuid , user_id uuid references users ( id ) )';

  it.each([
    ['as written', 'CREATE TABLE audit_entries (id uuid, user_id uuid REFERENCES users(id))'],
    [
      'IF NOT EXISTS',
      'CREATE TABLE IF NOT EXISTS audit_entries (id uuid, user_id uuid REFERENCES users(id))',
    ],
    [
      'UNLOGGED',
      'CREATE UNLOGGED TABLE audit_entries (id uuid, user_id uuid REFERENCES users(id))',
    ],
    [
      'TEMP and IF NOT EXISTS',
      'CREATE TEMP TABLE IF NOT EXISTS audit_entries (id uuid, user_id uuid REFERENCES users(id))',
    ],
    [
      'quoted and schema-qualified',
      'CREATE TABLE public."audit_entries" ( id uuid , user_id uuid REFERENCES users ( id ) )',
    ],
    [
      'spread over lines',
      'CREATE TABLE\n  audit_entries\n  (\n    id uuid,\n    user_id uuid REFERENCES users (id)\n  )',
    ],
  ])('reduces the %s spelling of a CREATE TABLE with a foreign key to one string', (_label, sql) => {
    expect(canonicalize(sql)).toEqual([CREATE_WITH_FK]);
  });

  it.each([
    ['as written', 'DROP TABLE audit_entries'],
    ['IF EXISTS', 'DROP TABLE IF EXISTS audit_entries'],
    ['IF EXISTS, quoted and qualified', 'DROP TABLE IF EXISTS public."audit_entries"'],
  ])('reduces the %s spelling of a DROP TABLE to one string', (_label, sql) => {
    expect(canonicalize(sql)).toEqual(['drop table audit_entries']);
  });

  it('drops the default schema from any table, not only from audit_entries', () => {
    // `public.` is the default schema, so `public.users` and `users` name one
    // table. The audit table's own qualifier is dropped by a separate rule —
    // which is exactly why this case is here: without it, nothing in this file
    // would notice the general rule going away.
    expect(canonicalize('CREATE TABLE public.users (id uuid)'))
      .toEqual(['create table users ( id uuid )']);
  });

  it('splits a composed argument into the statements it really is', () => {
    expect(
      canonicalize('COMMENT ON TABLE audit_entries IS \'x\'; ALTER TABLE audit_entries OWNER TO app'),
    ).toEqual(['comment on table audit_entries is \'x\'', OWNER_TO]);
  });

  it('keeps a string literal verbatim — its case, its semicolons, its doubled quotes', () => {
    // This is the half of canonicalization that must NOT happen. The
    // `COMMENT ON COLUMN audit_entries.actor_user_id` this schema ships says
    // "Deliberately not a foreign key" in its prose and contains an escaped
    // apostrophe; a normalizer that rewrote inside literals, or that ended the
    // literal at the `''`, would turn that comment into something the
    // foreign-key guard has to be taught to ignore all over again.
    const sql
      = 'COMMENT ON COLUMN audit_entries.actor_user_id IS '
        + '\'Deliberately not a foreign key; rewritten behind the application\'\'s back.\'';
    expect(canonicalize(sql)).toEqual([
      'comment on column audit_entries.actor_user_id is '
      + '\'Deliberately not a foreign key; rewritten behind the application\'\'s back.\'',
    ]);
  });

  it('lifts a dollar-quoted body out whole, however many apostrophes are in it', () => {
    // The round-5 regression, as a unit. An odd apostrophe inside `$do$ … $do$`
    // used to put the single-quote branch into a literal that ran to the end of
    // the argument, taking the `ALTER TABLE` after it out of view for every
    // guard at once.
    expect(canonicalize(
      'DO $do$ BEGIN RAISE NOTICE $m$it\'s fine$m$; END $do$;'
      + ' ALTER TABLE audit_entries OWNER TO app',
    )).toEqual([
      'do $do$ BEGIN RAISE NOTICE $m$it\'s fine$m$; END $do$',
      OWNER_TO,
    ]);
  });

  it('handles the empty dollar tag', () => {
    expect(canonicalize('DO $$ SELECT 1 $$; ALTER TABLE audit_entries OWNER TO app'))
      .toEqual(['do $$ SELECT 1 $$', OWNER_TO]);
  });

  it('does not fragment a dollar-quoted body around what is inside it', () => {
    // Everything the lexer reacts to, inside one opaque body: a statement
    // separator, both comment forms, an unbalanced apostrophe, and a second,
    // different dollar tag — which is ordinary text, not a nested quote.
    const body = '$do$ a; b -- c\n /* d */ e\'f $m$ g $m$ $do$';
    expect(canonicalize(`SELECT ${body}; ALTER TABLE audit_entries OWNER TO app`))
      .toEqual([`select ${body}`, OWNER_TO]);
  });

  it('an unterminated dollar quote is not a literal, so what follows stays visible', () => {
    // Fails closed, deliberately. Postgres refuses an unterminated dollar quote
    // outright, so no valid migration contains one and nothing legitimate is
    // affected; what the choice decides is whether an *invalid* one can be used
    // to hide the statement after it. It cannot.
    expect(canonicalize('SELECT $q$ unterminated; ALTER TABLE audit_entries OWNER TO app'))
      .toEqual(['select $q$ unterminated', OWNER_TO]);
  });

  it('an unterminated string literal is not a literal either, for the same reason', () => {
    expect(canonicalize('SELECT \'unterminated; ALTER TABLE audit_entries OWNER TO app'))
      .toEqual(['select \'unterminated', OWNER_TO]);
  });

  it('does not mistake a numbered bind parameter for a dollar tag', () => {
    // A tag follows the rules for an unquoted identifier and so cannot begin
    // with a digit: `$1$` is the parameter `$1` followed by a `$`. Reading it
    // as an opener would swallow everything up to the next `$1$` — which is
    // this statement's entire point.
    expect(canonicalize('SELECT $1$; ALTER TABLE audit_entries OWNER TO app; $1$'))
      .toEqual(['select $1$', OWNER_TO, '$1$']);
  });

  it('marks a Unicode-escaped identifier rather than pretending to read it', () => {
    // Not folded to `audit_entries` — folding it would mean decoding — and not
    // left looking like an ordinary name either. The marker is what its guard
    // matches.
    expect(canonicalize('ALTER TABLE U&"\\0061udit_entries" OWNER TO app'))
      .toEqual(['alter table unicode_escaped_identifier owner to app']);
    expect(canonicalize('ALTER TABLE "audit_entries" OWNER TO app')).toEqual([OWNER_TO]);
  });

  it('leaves the parameterized helper query alone', () => {
    // The one place this codebase writes `$n` at all. A lexer that treated
    // `$1::text, $2` as a dollar quote would swallow the rest of the argument.
    expect(canonicalize('SELECT format($1::text, $2::text) AS sql'))
      .toEqual(['select format ( $1::text , $2::text ) as sql']);
  });

  it('leaves audit_entries alone where it is the qualifier rather than the qualified', () => {
    // Dropping a schema qualifier must not drop a table qualifier. If it did,
    // every `COMMENT ON COLUMN audit_entries.…` would stop naming the table
    // and the foreign-key guard's non-vacuity count would silently fall.
    expect(canonicalize('COMMENT ON COLUMN public.audit_entries.actor_user_id IS NULL'))
      .toEqual(['comment on column audit_entries.actor_user_id is null']);
  });

  it('yields nothing for an argument with no statement in it', () => {
    expect(canonicalize('  ;  ;  ')).toEqual([]);
  });

  it('renders the real audit table creation as one statement carrying no foreign key', () => {
    // The end-to-end check: real migration, real extractor, real normalizer.
    // Everything above proves spellings collapse; this proves the collapse is
    // still pointed at the statement the guards are about.
    const created = canonicalStatements(migrationSource('IdentityFoundation'))
      .filter((sql) => /^create table audit_entries\b/.test(sql));
    expect(created).toHaveLength(1);
    expect(created[0]).not.toMatch(/\breferences\b/);
  });
});

describe('the guards refuse every spelling that voids D13', () => {
  // A guard that has only ever been run against migrations it passes is a
  // guard nobody has watched refuse anything. Each case below is a corpus of
  // one constructed offender, handed to the same predicate the real assertion
  // uses, and the predicate has to find it. This is the fault injection that
  // used to be done by hand against a generated probe, once per review round —
  // written as tests, so it happens on every run instead.

  /** One offender, canonicalized and tagged exactly as a real corpus is. */
  function corpus(sql: string): Tagged[] {
    return canonicalize(sql).map((statement) => ['injected.ts', statement] as const);
  }

  it.each([
    'ALTER TABLE audit_entries OWNER TO app',
    'alter table audit_entries owner to app',
    'ALTER  TABLE  audit_entries  OWNER  TO  app',
    'ALTER TABLE\n  audit_entries\n  OWNER TO app',
    'ALTER TABLE ONLY audit_entries OWNER TO app',
    'ALTER TABLE public.audit_entries OWNER TO app',
    'ALTER TABLE "audit_entries" OWNER TO app',
    'ALTER TABLE public."audit_entries" OWNER TO app',
    'ALTER TABLE "public"."audit_entries" OWNER TO app',
    'ALTER TABLE /* nothing to see */ audit_entries OWNER TO app',
    'COMMENT ON TABLE audit_entries IS \'x\'; ALTER TABLE audit_entries OWNER TO app',
    'ALTER TABLE audit_entries DROP COLUMN metadata',
    'ALTER TABLE audit_entries DISABLE TRIGGER ALL',
    'ALTER TABLE audit_entries RENAME TO audit_entries_old',
    'ALTER TABLE audit_entries ALTER COLUMN actor_user_id DROP NOT NULL',
    'ALTER TABLE audit_entries ADD CONSTRAINT fk_actor FOREIGN KEY (actor_user_id)'
    + ' REFERENCES users (id) ON DELETE CASCADE',
  ])('the ALTER TABLE allow-list refuses %p', (sql) => {
    const found = alterTableStatements(corpus(sql));
    // Seen at all — the bypass of rounds 1–4 was invisibility, not acceptance.
    expect(found.length).toBeGreaterThan(0);
    // ...and not on the list.
    expect(found.filter((statement) => PERMITTED_ALTERS.includes(statement))).toEqual([]);
  });

  it.each([
    'ALTER TABLE audit_entries ALTER COLUMN organization_id TYPE uuid USING organization_id::uuid',
    'ALTER TABLE   audit_entries\n  ALTER COLUMN organization_id TYPE uuid'
    + '\n  USING organization_id::uuid',
    'alter table only public."audit_entries" alter column organization_id type uuid'
    + ' using organization_id::uuid',
  ])('and accepts the permitted cast spelled %p', (sql) => {
    expect(alterTableStatements(corpus(sql))).toEqual([PERMITTED_ALTERS[0]]);
  });

  it.each([
    'ALTER TABLE audit_entries ADD CONSTRAINT fk FOREIGN KEY (actor_user_id)'
    + ' REFERENCES users (id) ON DELETE CASCADE',
    'ALTER TABLE "audit_entries" ADD FOREIGN KEY (actor_user_id) REFERENCES users (id)',
    'ALTER TABLE ONLY public.audit_entries ADD CONSTRAINT fk FOREIGN KEY (actor_user_id)'
    + ' REFERENCES users (id)',
    'CREATE TABLE audit_entries (id uuid, actor_user_id uuid REFERENCES users (id))',
    'COMMENT ON TABLE audit_entries IS \'x\'; CREATE TABLE IF NOT EXISTS audit_entries'
    + ' (id uuid, actor_user_id uuid REFERENCES users (id))',
  ])('the foreign-key guard refuses %p', (sql) => {
    expect(foreignKeyOffenders(corpus(sql))).not.toEqual([]);
  });

  it.each([
    'CREATE TABLE audit_entries (id uuid, user_id uuid REFERENCES users (id))',
    'CREATE TABLE IF NOT EXISTS audit_entries (id uuid, user_id uuid REFERENCES users (id))',
    'CREATE UNLOGGED TABLE audit_entries (id uuid, user_id uuid REFERENCES users (id))',
    'COMMENT ON TABLE audit_entries IS \'x\'; CREATE TABLE audit_entries'
    + ' (id uuid, user_id uuid REFERENCES users (id))',
    'COMMENT ON TABLE audit_entries IS \'x\'; CREATE TABLE IF NOT EXISTS audit_entries'
    + ' (id uuid, user_id uuid REFERENCES users (id))',
    'CREATE TABLE public."audit_entries" (id uuid,'
    + ' CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users (id))',
  ])('the CREATE TABLE body guard refuses %p', (sql) => {
    expect(createTableForeignKeyOffenders(corpus(sql))).not.toEqual([]);
  });

  it('and the CREATE TABLE body guard accepts the real one, which has no REFERENCES', () => {
    const real = canonicalStatements(migrationSource('IdentityFoundation'))
      .map((sql) => ['IdentityFoundation', sql] as const);
    expect(auditCreateBodies(real)).toHaveLength(1);
    expect(createTableForeignKeyOffenders(real)).toEqual([]);
  });

  it('and the foreign-key guard accepts the comment that says there is no foreign key', () => {
    // The false positive the `COMMENT ON` exclusion exists to prevent, asserted
    // rather than argued: this statement's own prose contains the words this
    // guard searches for.
    const comment = canonicalStatements(migrationSource('IdentityFoundation'))
      .filter((sql) => /^comment on column audit_entries\.actor_user_id\b/.test(sql));
    expect(comment).toHaveLength(1);
    expect(comment[0]).toMatch(/foreign key/);
    expect(foreignKeyOffenders(comment.map((sql) => ['IdentityFoundation', sql] as const)))
      .toEqual([]);
  });

  it.each([
    'ALTER TABLE users ADD CONSTRAINT fk FOREIGN KEY (last_audit) REFERENCES audit_entries (id)',
    'ALTER TABLE users ADD CONSTRAINT fk FOREIGN KEY (last_audit) REFERENCES "audit_entries" (id)',
    'ALTER TABLE users ADD CONSTRAINT fk FOREIGN KEY (last_audit)'
    + ' REFERENCES public.audit_entries (id)',
    'ALTER TABLE users ADD CONSTRAINT fk FOREIGN KEY (last_audit)'
    + ' REFERENCES public."audit_entries"(id)',
    'CREATE TABLE notes (id uuid, entry uuid references AUDIT_ENTRIES (id) ON DELETE CASCADE)',
    'CREATE TABLE notes (id uuid, entry uuid REFERENCES\n  archive.audit_entries (id))',
  ])('the reverse REFERENCES guard refuses %p', (sql) => {
    expect(referencesAuditOffenders(corpus(sql))).not.toEqual([]);
  });

  it.each([
    'GRANT UPDATE, DELETE ON audit_entries TO app',
    'GRANT DELETE ON public."audit_entries" TO app',
    'GRANT UPDATE ON ALL TABLES IN SCHEMA public TO app',
    'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app',
  ])('the grant allow-list refuses %p', (sql) => {
    const found = grantStatements(corpus(sql));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((statement) => PERMITTED_GRANTS.includes(statement))).toEqual([]);
  });

  it.each([
    'REASSIGN OWNED BY owner TO app',
    'ALTER TABLE ALL IN TABLESPACE pg_default OWNER TO app',
  ])('the wholesale-ownership guard refuses %p', (sql) => {
    expect(wholesaleOwnershipStatements(corpus(sql))).not.toEqual([]);
  });

  // Round 5. Every one of these was green — silently, with the guards reading
  // an empty corpus rather than reading and permitting — until the lexer grew
  // a dollar-quote branch. Kept as one case per guard, because the failure was
  // never guard-specific: one lexer sits under all of them.
  const DO_BLOCK = 'DO $do$ BEGIN RAISE NOTICE $m$it\'s fine$m$; END $do$';

  it.each([
    `${DO_BLOCK}; ALTER TABLE audit_entries OWNER TO app`,
    `${DO_BLOCK}; ALTER TABLE audit_entries DROP COLUMN metadata`,
  ])('the ALTER TABLE allow-list refuses %p behind a dollar quote', (sql) => {
    const found = alterTableStatements(corpus(sql));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((statement) => PERMITTED_ALTERS.includes(statement))).toEqual([]);
  });

  it('the grant allow-list refuses a GRANT behind a dollar quote', () => {
    const found = grantStatements(
      corpus(`${DO_BLOCK}; GRANT UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app`),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((statement) => PERMITTED_GRANTS.includes(statement))).toEqual([]);
  });

  it('the wholesale-ownership guard refuses a REASSIGN behind a dollar quote', () => {
    expect(wholesaleOwnershipStatements(corpus(`${DO_BLOCK}; REASSIGN OWNED BY owner TO app`)))
      .not.toEqual([]);
  });

  it('the CREATE TABLE body guard refuses an inline foreign key behind a dollar quote', () => {
    expect(createTableForeignKeyOffenders(corpus(
      `${DO_BLOCK}; CREATE TABLE audit_entries (id uuid, user_id uuid REFERENCES users(id))`,
    ))).not.toEqual([]);
  });

  it('the reverse REFERENCES guard refuses a foreign key behind a dollar quote', () => {
    expect(referencesAuditOffenders(corpus(
      `${DO_BLOCK}; ALTER TABLE users ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES audit_entries (id)`,
    ))).not.toEqual([]);
  });

  it.each([
    'ALTER TABLE U&"audit_entries" OWNER TO app',
    'ALTER TABLE U&"\\0061udit_entries" OWNER TO app',
    'ALTER TABLE u&"\\0061udit_entries" UESCAPE \'!\' OWNER TO app',
    'ALTER TABLE users ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES U&"audit_entries" (id)',
  ])('the Unicode-escaped-identifier guard refuses %p', (sql) => {
    expect(unicodeEscapedIdentifiers(corpus(sql))).not.toEqual([]);
  });

  it('and refuses a statement sandwiched between two dollar-quoted bodies', () => {
    // The second shape the review constructed: the offending statement is not
    // at the end, and the apostrophe that used to break the lexer is inside the
    // first body rather than after it.
    const found = alterTableStatements(corpus(
      'SELECT $q$ he said \'hi $q$; ALTER TABLE audit_entries OWNER TO app; SELECT $q$ \' $q$',
    ));
    expect(found).toEqual(['alter table audit_entries owner to app']);
  });

  it('the created-once guard sees a rebuild however it is spelled', () => {
    // `CREATE TABLE IF NOT EXISTS` beside `DROP TABLE IF EXISTS` is the
    // ordinary way somebody writes a rebuild by hand, and it was this file's
    // longest-standing disclosed gap: three rounds of review left it open
    // because closing it meant another spelling-specific regex. It closed
    // itself when the guard moved onto the canonical form.
    const rebuild = corpus(
      'DROP TABLE IF EXISTS audit_entries; CREATE TABLE IF NOT EXISTS audit_entries (id uuid)',
    );
    expect(statementsMatching(/\bdrop table audit_entries\b/, rebuild)).toHaveLength(1);
    expect(statementsMatching(/\bcreate table audit_entries\b/, rebuild)).toHaveLength(1);
  });
});

describe('each guard fails, rather than passes, when what it examines is absent', () => {
  // The failure this file has had more than once: an assertion of the form "no
  // statement does X", run against a corpus that became empty for an unrelated
  // reason, reports green and means nothing. So for every guard, either the
  // assertion itself cannot be satisfied by an empty corpus (the two
  // allow-lists, which are set equality against a non-empty list), or the test
  // carries a companion assertion that is — and this block is where the
  // companion is proved to be load-bearing.

  const NOTHING: Tagged[] = [];

  it('the ALTER TABLE allow-list cannot be satisfied by an empty corpus', () => {
    expect([...alterTableStatements(NOTHING)].sort()).not.toEqual([...PERMITTED_ALTERS].sort());
  });

  it('the grant allow-list cannot be satisfied by an empty corpus', () => {
    expect([...grantStatements(NOTHING)].sort()).not.toEqual([...PERMITTED_GRANTS].sort());
  });

  it('the CREATE TABLE body guard: its body count is what refuses an empty corpus', () => {
    // The offender list alone says "clean" — indistinguishable from a schema
    // that creates the table properly...
    expect(createTableForeignKeyOffenders(NOTHING)).toEqual([]);
    // ...so the guard asserts this first, and this is what is red.
    expect(auditCreateBodies(NOTHING)).toHaveLength(0);
  });

  it('the foreign-key guard: its naming count is what refuses an empty corpus', () => {
    expect(foreignKeyOffenders(NOTHING)).toEqual([]);
    expect(auditNamingStatements(NOTHING).length).toBeLessThan(3);
  });

  it('the foreign-key guard: the COMMENT ON exclusion alone can empty the haystack', () => {
    // Not a hypothetical. The exclusion is the one thing in this guard that
    // removes statements, so a corpus of nothing but comments is the shape an
    // over-broad exclusion would produce, and the naming count is what says so.
    const comments = canonicalize('COMMENT ON TABLE audit_entries IS \'x\'')
      .map((sql) => ['injected.ts', sql] as const);
    expect(comments).toHaveLength(1);
    expect(foreignKeyOffenders(comments)).toEqual([]);
    expect(auditNamingStatements(comments).length).toBeLessThan(3);
  });

  it('the reverse REFERENCES guard: its corpus-size check is what refuses an empty corpus', () => {
    expect(referencesAuditOffenders(NOTHING)).toEqual([]);
    expect(NOTHING.length).not.toBeGreaterThan(0);
  });

  it('the wholesale-ownership guard: its corpus-size check is what refuses an empty corpus', () => {
    expect(wholesaleOwnershipStatements(NOTHING)).toEqual([]);
    expect(NOTHING.length).not.toBeGreaterThan(0);
  });

  it('the Unicode-identifier guard: its corpus-size check is what refuses an empty corpus', () => {
    expect(unicodeEscapedIdentifiers(NOTHING)).toEqual([]);
    expect(NOTHING.length).not.toBeGreaterThan(0);
  });

  it('and the real corpus is not empty, which is what makes all of the above matter', () => {
    const statements = allCanonicalStatements();
    expect(statements.length).toBeGreaterThan(0);
    expect(auditNamingStatements(statements).length).toBeGreaterThanOrEqual(3);
    expect(auditCreateBodies(statements)).toHaveLength(1);
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
    const statements = allCanonicalStatements();
    // The `COMMENT ON` exclusion must not empty the haystack. Without this
    // line the assertion below passes for the wrong reason the moment anything
    // upstream stops producing statements, which is precisely how it failed
    // before.
    expect(auditNamingStatements(statements).length).toBeGreaterThanOrEqual(3);
    expect(foreignKeyOffenders(statements)).toEqual([]);
  });

  // The second direction the test above cannot reach on its own: a
  // `REFERENCES` in `audit_entries`'s *own* column list, at creation.
  //
  //   COMMENT ON TABLE audit_entries IS 'x';
  //   CREATE TABLE IF NOT EXISTS audit_entries (id uuid, user_id uuid REFERENCES users(id));
  //
  // Rounds 3 and 4 both arrived here, by different spellings of the same
  // statement, and neither of the other guards applies: the `ALTER TABLE`
  // allow-list is the wrong keyword, and the reverse `REFERENCES
  // audit_entries` guard is the wrong direction — `audit_entries` is this
  // key's *source*, not its target. It matters precisely because it is the
  // CREATE: a `REFERENCES users (id)` smuggled into the table's own
  // construction is exactly the referential-action hazard
  // `IdentityFoundation` refused for `actor_user_id` — delete a user and the
  // reference rewrites or erases an audit row through a statement aimed at
  // `users`, past the REVOKE.
  //
  // Anchored on structure rather than on the leading keyword, so no prefix
  // hides anything from it, and read off the canonical form, so no spelling
  // of the create does either. See `createTableForeignKeyOffenders` for why
  // this guard must *not* take the `COMMENT ON` exclusion its sibling needs.
  it('and no migration creates it with a foreign key inside its own CREATE TABLE, whatever precedes the statement', () => {
    const statements = allCanonicalStatements();
    // Non-vacuity: there is a `CREATE TABLE audit_entries` to examine. Without
    // this the assertion below is green against a schema that never creates
    // the table at all, which is also the shape it takes if canonicalization
    // stops producing the string this predicate looks for.
    expect(auditCreateBodies(statements)).toHaveLength(1);
    expect(createTableForeignKeyOffenders(statements)).toEqual([]);
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
  it('collects every ALTER TABLE audit_entries statement, canonical, and checks it against the allow-list', () => {
    // Set equality, not containment: an extra statement fails as loudly as a
    // missing one, and an empty corpus fails too — which is this guard's own
    // non-vacuity proof, since `[] ` is not `PERMITTED`.
    expect([...alterTableStatements(allCanonicalStatements())].sort())
      .toEqual([...PERMITTED_ALTERS].sort());
  });
});

describe('audit_entries never has its privileges handed back', () => {
  // The REVOKE is undone by naming the table again — which the allow-list
  // above catches — and equally by never naming it. `GRANT UPDATE ON ALL
  // TABLES IN SCHEMA public TO <app role>` in any later migration restores
  // both privileges on the audit log without the string `audit_entries`
  // appearing anywhere in it, and `REASSIGN OWNED BY` hands over ownership,
  // which is not subject to the REVOKE at all. Both were open, both are
  // cheap, so both are closed here rather than added to the disclosure at the
  // top of this file.

  it('grants exactly what the revert of the audit migration grants, and nothing else', () => {
    expect([...grantStatements(allCanonicalStatements())].sort())
      .toEqual([...PERMITTED_GRANTS].sort());
  });

  it('and no migration changes table ownership wholesale', () => {
    const statements = allCanonicalStatements();
    expect(statements.length).toBeGreaterThan(0);
    expect(wholesaleOwnershipStatements(statements)).toEqual([]);
  });

  it('and no migration writes a Unicode-escaped identifier', () => {
    const statements = allCanonicalStatements();
    expect(statements.length).toBeGreaterThan(0);
    expect(unicodeEscapedIdentifiers(statements)).toEqual([]);
  });
});

describe('the organizations-and-authorization migration', () => {
  const phase3 = migrationSource('OrganizationsAndAuthorization');

  /**
   * The column list of one `CREATE TABLE` in THIS migration, and nothing after
   * it.
   *
   * The same helper `the schema migration` defines, for the same reason its
   * comment gives at length: an unbounded `[\s\S]*?` between a table name and
   * a referential action simply runs on into the next table that still has one,
   * so every such assertion passes with the clause deleted. Duplicated rather
   * than hoisted because each is closed over its own migration's source, and a
   * shared one would need the source passed in at every call — which is the
   * argument most easily got wrong in exactly the way this bounding exists to
   * prevent.
   */
  function createTableBody(table: string): string {
    const match = new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\s*\\)`).exec(phase3);
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  /**
   * One column's definition line, and only that line.
   *
   * Bounded to the line rather than to the table, which is a second bound on
   * top of `createTableBody`'s and is the one that matters here.
   * `organization_invitations` carries **two** `ON DELETE SET NULL` columns, so
   * an assertion made against the whole table body passes with either one of
   * them changed — the other still supplies the string. Per column is the only
   * granularity at which these can fail.
   */
  function columnDefinition(table: string, column: string): string {
    const line = createTableBody(table)
      .split('\n')
      .filter((each) => new RegExp(`^\\s*${column}\\s`).test(each))[0];
    expect(line).toBeDefined();
    return line ?? '';
  }

  /**
   * Every column whose account may go away without taking the row with it.
   *
   * These three are the reason `Invitation.invitedByUserId`,
   * `Invitation.acceptedByUserId` and `ResourceGrant.grantedBy` are
   * `UserId | null` on core's types and `string | null` on the record classes.
   * **Nothing else in this repository asserts them.** `to-invitation.ts` and
   * `to-grant.ts` read the columns as nullable, and `tenant-isolation.spec.ts`
   * records that the state is unreachable from the fast tier — `FakeDataSource`
   * has no foreign keys, so deleting a user there leaves a dangling id rather
   * than a nulled column, which is a different state and not one worth faking.
   * That leaves the clause itself, here, as the whole of the coverage.
   */
  const NULLED_ON_ACCOUNT_DELETE: ReadonlyArray<readonly [string, string]> = [
    ['organization_invitations', 'invited_by_user_id'],
    ['organization_invitations', 'accepted_by_user_id'],
    ['resource_grants', 'granted_by'],
  ];

  it.each(NULLED_ON_ACCOUNT_DELETE)(
    'nulls %s.%s when the account it names is deleted, rather than deleting the row',
    (table, column) => {
      const definition = columnDefinition(table, column);
      // Two propositions, and both are needed. `ON DELETE SET NULL` on a NOT
      // NULL column is a schema Postgres accepts at creation and then fails at
      // the first delete, so the nullability is not decoration — it is the half
      // that makes the action executable.
      expect(definition).toMatch(/\buuid\s+NULL\b/);
      expect(definition).toContain('REFERENCES users (id) ON DELETE SET NULL');
    },
  );

  // The counterweight. Every assertion above says "this column is spared"; none
  // of them says anything about the columns that must NOT be, and a migration
  // that spared all of them would satisfy the three rows above completely. An
  // invitation whose organization is deleted, or a grant whose subject is, has
  // no meaning left — those cascade, and here is where that is said.
  it.each([
    ['memberships', 'organization_id', 'organizations'],
    ['memberships', 'user_id', 'users'],
    ['organization_invitations', 'organization_id', 'organizations'],
    ['resource_grants', 'organization_id', 'organizations'],
    ['resource_grants', 'subject_user_id', 'users'],
  ])('cascades %s.%s from %s', (table, column, referenced) => {
    expect(columnDefinition(table, column))
      .toContain(`REFERENCES ${referenced} (id) ON DELETE CASCADE`);
  });

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
    // Quoting, schema-qualification and case are not spelled out here, and
    // that is the point: they are gone by the time this predicate reads the
    // statement. Quoting one guard's table name and not its sibling's is how
    // this exact bypass slipped through in round 1, and there is now only one
    // spelling for either of them to disagree about.
    const statements = allCanonicalStatements();
    // Non-vacuity: there are statements to search, and they are the canonical
    // ones. An empty corpus would make the assertion below unfalsifiable.
    expect(statements.length).toBeGreaterThan(0);
    expect(referencesAuditOffenders(statements)).toEqual([]);
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
  // Read off the canonical statements, so `CREATE TABLE IF NOT EXISTS
  // audit_entries` and `DROP TABLE IF EXISTS audit_entries` — the ordinary way
  // somebody writes a rebuild by hand, and a gap this file disclosed for three
  // rounds — are the same statements as the ones written without the guard
  // clause. `AuditAppendOnly`'s TSDoc, which is where somebody about to
  // rebuild the table is actually reading, says the same.

  const creators = allMigrations.filter(([, source]) =>
    canonicalStatements(source).some((sql) => /\bcreate table audit_entries\b/.test(sql)),
  );

  it('is created by exactly one migration', () => {
    expect(creators.map(([name]) => name)).toHaveLength(1);
  });

  it('is dropped by no other migration, and only in that one\'s down()', () => {
    const [creatorName, creatorSource] = creators[0];
    const elsewhere = allCanonicalStatements().filter(([name]) => name !== creatorName);
    expect(statementsMatching(/\bdrop table audit_entries\b/, elsewhere)).toEqual([]);

    const inUp = canonicalStatements(upBody(creatorSource)).map(
      (sql) => [creatorName, sql] as const,
    );
    expect(inUp.length).toBeGreaterThan(0);
    expect(statementsMatching(/\bdrop table audit_entries\b/, inUp)).toEqual([]);
    // ...and it really is dropped, in down(). Otherwise "not in up()" is true
    // of a migration that never drops it at all.
    expect(statementsMatching(/\bdrop table audit_entries\b/)).toHaveLength(1);
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
