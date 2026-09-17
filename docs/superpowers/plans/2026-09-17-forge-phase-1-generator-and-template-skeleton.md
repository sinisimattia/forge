# Forge Phase 1 — Generator and Template Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run create -- --name my-app` produces a bootable, agent-ready NX monorepo — process layer, workspace shell, `libs/core`, NestJS backend and Nuxt webapp — that passes its own lint/typecheck/test/build gates and serves `/health`.

**Architecture:** One `template/` tree copied wholesale by a dependency-free generator. The generator stages into a sibling directory of the target (same filesystem, so the final move is an atomic rename), substitutes `__FORGE_*__` tokens in file contents and path segments, then hard-fails if any token survives. A second mode copies only the process subset into a repository that already exists, never overwriting.

**Tech Stack:** Node 22 (`node:fs`, `node:path`, `node:readline/promises`, `node:test` — no dependencies in forge itself). The generated project uses NX, NestJS, TypeORM, PostgreSQL, Nuxt 4, Vue 3, Tailwind, Jest, Vitest, Storybook, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-17-forge-template-design.md`

## Global Constraints

- **Node `>=22 <23`** everywhere — forge itself and every generated package.
- **Forge has zero runtime and zero test dependencies.** Use `node --test`. If you reach for a package, you have taken a wrong turn.
- **`~/Progetti/Voku` is strictly read-only.** Never write, never `git add`, never branch. Extraction is copy-out only. After every task that touches it, `git -C ~/Progetti/Voku status --porcelain` must be empty and `git -C ~/Progetti/Voku rev-parse --short HEAD` must be `fdfdbde`.
- **Tokens are `__FORGE_NAME__`, `__FORGE_TITLE__`, `__FORGE_SCOPE__`, `__FORGE_DESCRIPTION__`, `__FORGE_DB_NAME__`.** No other token spelling is valid. The unresolved-token guard matches `/__FORGE_[A-Z0-9_]*__/g` and nothing else — `window.__NUXT__` and `__dirname` must never match.
- **Zero Voku traces.** `grep -ri voku template/ tools/` must return nothing. Neutral example vocabulary for docs is `Article` / `Comment` / `Tag` — never Event, Ticket, RSVP, Invitation, Payment.
- **No secrets, ever.** `.env.example` carries empty values only. `grep -rE "sk_|pk_live|SECRET=|PASSWORD=|BEGIN .* PRIVATE KEY" template/` must return nothing.
- **`libs/core` purity.** No framework imports, and no transport vocabulary (`jwt`, `cookie`, `http`) in code *or* prose.
- All paths below are relative to `/Users/sinisimattia/Progetti/forge` unless stated otherwise.
- **Import conventions verified against Voku — do not improvise.** `libs/core` uses `moduleResolution: "bundler"`, so barrels are `export * from './Symbol'` with **no `.js` extension**. Webapp stories import types from `@storybook-vue/nuxt` and components via the `~/components/...` alias, and use `} satisfies Meta<typeof X>` with `type Story = StoryObj<typeof meta>`.

---

## File Structure

**Forge tooling** — each module has one responsibility and is unit-testable without touching the filesystem where possible:

| File | Responsibility |
|---|---|
| `tools/create/tokens.mjs` | Derive token values from answers; substitute; detect unresolved |
| `tools/create/args.mjs` | Parse and validate `argv`; decide mode; typed usage errors |
| `tools/create/prompts.mjs` | Interactive prompting for missing answers |
| `tools/create/copy.mjs` | Tree walk, binary detection, staged copy with substitution |
| `tools/create/subset.mjs` | Process-subset membership + never-overwrite copy |
| `tools/create/receipt.mjs` | Build `forge.json` |
| `tools/create/git.mjs` | `git init` + initial commit |
| `tools/create/index.mjs` | Orchestration only — no logic of its own |

**Template** — `template/` holds the generated project; its layout is specified in §8 and §10 of the spec.

---

## Task 1: Token derivation and substitution

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `tools/create/tokens.mjs`
- Test: `tests/unit/tokens.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `TOKEN_PATTERN: RegExp`, `toTitle(name: string): string`, `deriveTokens(answers: {name, title?, scope?, description?, dbName?}): Record<string,string>`, `substitute(text: string, tokens: Record<string,string>): string`, `findUnresolved(text: string): string[]`.

- [ ] **Step 1: Create the forge package manifest and gitignore**

`package.json`:

```json
{
  "name": "forge",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Application template workspace — generates new projects from one template tree.",
  "scripts": {
    "create": "node tools/create/index.mjs",
    "test": "node --test 'tests/unit/**/*.test.mjs'",
    "test:integration": "node --test --test-timeout=1800000 'tests/integration/**/*.test.mjs'",
    "test:all": "npm test && npm run test:integration"
  },
  "engines": { "node": ">=22 <23" }
}
```

`.gitignore`:

```
node_modules/
dist/
.DS_Store
template/**/node_modules/
template/**/dist/
template/**/.nuxt/
template/**/.output/
template/**/coverage/
```

- [ ] **Step 2: Write the failing test**

`tests/unit/tokens.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTitle, deriveTokens, substitute, findUnresolved } from '../../tools/create/tokens.mjs';

test('toTitle turns a kebab name into a human title', () => {
  assert.equal(toTitle('my-app'), 'My App');
  assert.equal(toTitle('billover'), 'Billover');
  assert.equal(toTitle('a-b-c'), 'A B C');
});

test('deriveTokens derives title, scope and db name from the project name', () => {
  const t = deriveTokens({ name: 'my-app' });
  assert.equal(t.__FORGE_NAME__, 'my-app');
  assert.equal(t.__FORGE_TITLE__, 'My App');
  assert.equal(t.__FORGE_SCOPE__, '@my-app');
  assert.equal(t.__FORGE_DB_NAME__, 'my_app');
  assert.equal(t.__FORGE_DESCRIPTION__, '');
});

test('deriveTokens lets explicit answers win over derived ones', () => {
  const t = deriveTokens({
    name: 'my-app', title: 'Custom Title', scope: '@other',
    description: 'Hello.', dbName: 'custom_db',
  });
  assert.equal(t.__FORGE_TITLE__, 'Custom Title');
  assert.equal(t.__FORGE_SCOPE__, '@other');
  assert.equal(t.__FORGE_DESCRIPTION__, 'Hello.');
  assert.equal(t.__FORGE_DB_NAME__, 'custom_db');
});

test('deriveTokens requires a name', () => {
  assert.throws(() => deriveTokens({}), /name is required/);
});

test('substitute replaces known tokens and leaves unknown ones for the guard', () => {
  const out = substitute('a=__FORGE_NAME__ b=__FORGE_NOPE__', { __FORGE_NAME__: 'my-app' });
  assert.equal(out, 'a=my-app b=__FORGE_NOPE__');
});

test('substitute replaces every occurrence', () => {
  const out = substitute('__FORGE_NAME__/__FORGE_NAME__', { __FORGE_NAME__: 'x' });
  assert.equal(out, 'x/x');
});

test('findUnresolved reports only forge tokens, never other dunder identifiers', () => {
  assert.deepEqual(findUnresolved('window.__NUXT__ and __dirname and __filename'), []);
  assert.deepEqual(findUnresolved('x __FORGE_MISSING__ y __FORGE_MISSING__'), ['__FORGE_MISSING__']);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../tools/create/tokens.mjs'`

- [ ] **Step 4: Write the implementation**

`tools/create/tokens.mjs`:

```js
/** Matches forge tokens only, so `window.__NUXT__` and `__dirname` never trip the guard. */
export const TOKEN_PATTERN = /__FORGE_[A-Z0-9_]*__/g;

/** `my-app` -> `My App` */
export function toTitle(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** Builds the full token map, deriving anything the caller did not supply. */
export function deriveTokens({ name, title, scope, description, dbName } = {}) {
  if (!name) throw new Error('name is required');
  return {
    __FORGE_NAME__: name,
    __FORGE_TITLE__: title || toTitle(name),
    __FORGE_SCOPE__: scope || `@${name}`,
    __FORGE_DESCRIPTION__: description || '',
    __FORGE_DB_NAME__: dbName || name.replaceAll('-', '_'),
  };
}

/**
 * Replaces known tokens. Unknown tokens are deliberately left in place so
 * `findUnresolved` can fail the run rather than silently emitting a broken file.
 */
export function substitute(text, tokens) {
  return text.replace(TOKEN_PATTERN, (match) =>
    Object.hasOwn(tokens, match) ? tokens[match] : match,
  );
}

/** Distinct forge tokens still present in `text`. */
export function findUnresolved(text) {
  return [...new Set(text.match(TOKEN_PATTERN) ?? [])];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore tools/create/tokens.mjs tests/unit/tokens.test.mjs
git commit -m "feat(create): derive and substitute forge tokens"
```

---

## Task 2: Argument parsing and validation

**Files:**
- Create: `tools/create/args.mjs`
- Test: `tests/unit/args.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `class UsageError extends Error` (with `exitCode = 1`), `parseArgs(argv: string[]): {mode: 'create'|'adopt', into?: string, name?: string, title?: string, scope?: string, description?: string, dbName?: string, out: string, git: boolean, yes: boolean}`, and the exported regexes `NAME_RE`, `SCOPE_RE`, `DB_NAME_RE`.

- [ ] **Step 1: Write the failing test**

`tests/unit/args.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, UsageError } from '../../tools/create/args.mjs';

test('parses create mode with a name', () => {
  const a = parseArgs(['--name', 'my-app']);
  assert.equal(a.mode, 'create');
  assert.equal(a.name, 'my-app');
  assert.equal(a.out, process.cwd());
  assert.equal(a.git, true);
  assert.equal(a.yes, false);
});

test('parses every create flag', () => {
  const a = parseArgs([
    '--name', 'my-app', '--title', 'My App', '--scope', '@acme',
    '--description', 'Hi.', '--db-name', 'my_db', '--out', '/tmp/x',
    '--no-git', '--yes',
  ]);
  assert.deepEqual(
    [a.title, a.scope, a.description, a.dbName, a.out, a.git, a.yes],
    ['My App', '@acme', 'Hi.', 'my_db', '/tmp/x', false, true],
  );
});

test('parses adopt mode', () => {
  const a = parseArgs(['--into', '/tmp/existing']);
  assert.equal(a.mode, 'adopt');
  assert.equal(a.into, '/tmp/existing');
});

test('rejects combining --into with --name or --out', () => {
  assert.throws(() => parseArgs(['--into', '/tmp/x', '--name', 'y']), UsageError);
  assert.throws(() => parseArgs(['--into', '/tmp/x', '--out', '/tmp/y']), UsageError);
});

test('enforces --into exclusivity even when the other value is empty', () => {
  // A truthiness check would let both of these through.
  assert.throws(() => parseArgs(['--into', '/tmp/x', '--name', '']), UsageError);
  assert.throws(() => parseArgs(['--into', '', '--name', 'y']), UsageError);
});

test('rejects an empty --into path', () => {
  assert.throws(() => parseArgs(['--into', '']), UsageError);
});

test('rejects an empty --name', () => {
  assert.throws(() => parseArgs(['--name', '']), UsageError);
});

test('rejects an invalid project name', () => {
  for (const bad of ['My-App', '1app', 'my_app', 'my app', '-leading']) {
    assert.throws(() => parseArgs(['--name', bad]), UsageError, `expected ${bad} to be rejected`);
  }
});

test('rejects an invalid scope or db name', () => {
  assert.throws(() => parseArgs(['--name', 'a', '--scope', 'acme']), UsageError);
  assert.throws(() => parseArgs(['--name', 'a', '--db-name', '1db']), UsageError);
});

test('rejects an unknown flag', () => {
  assert.throws(() => parseArgs(['--nope']), UsageError);
});

test('UsageError carries exit code 1', () => {
  try { parseArgs(['--nope']); assert.fail('should throw'); }
  catch (error) { assert.equal(error.exitCode, 1); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `tools/create/args.mjs`

- [ ] **Step 3: Write the implementation**

`tools/create/args.mjs`:

```js
export const NAME_RE = /^[a-z][a-z0-9-]*$/;
export const SCOPE_RE = /^@[a-z0-9][a-z0-9-]*$/;
export const DB_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** A problem with what the user typed. Always exit code 1. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 1;
  }
}

const VALUE_FLAGS = new Map([
  ['--name', 'name'],
  ['--title', 'title'],
  ['--scope', 'scope'],
  ['--description', 'description'],
  ['--db-name', 'dbName'],
  ['--out', 'out'],
  ['--into', 'into'],
]);

export function parseArgs(argv) {
  const parsed = { git: true, yes: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--no-git') { parsed.git = false; continue; }
    if (flag === '--yes' || flag === '-y') { parsed.yes = true; continue; }

    const key = VALUE_FLAGS.get(flag);
    if (!key) throw new UsageError(`Unknown flag: ${flag}`);

    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${flag} requires a value`);
    }
    parsed[key] = value;
    i += 1;
  }

  // Presence checks must be `!== undefined`, never truthiness: an empty-string
  // value would otherwise skip adopt mode entirely and let the forbidden
  // `--into` + `--name` combination through.
  if (parsed.into !== undefined) {
    if (parsed.into === '') throw new UsageError('--into requires a directory path');
    if (parsed.name !== undefined) throw new UsageError('--into cannot be combined with --name');
    if (parsed.out !== undefined) throw new UsageError('--into cannot be combined with --out');
    return { ...parsed, mode: 'adopt', out: process.cwd() };
  }

  if (parsed.name !== undefined && !NAME_RE.test(parsed.name)) {
    throw new UsageError(
      `Invalid --name "${parsed.name}". Use lowercase letters, digits and hyphens, starting with a letter.`,
    );
  }
  if (parsed.scope !== undefined && !SCOPE_RE.test(parsed.scope)) {
    throw new UsageError(`Invalid --scope "${parsed.scope}". Expected something like "@my-app".`);
  }
  if (parsed.dbName !== undefined && !DB_NAME_RE.test(parsed.dbName)) {
    throw new UsageError(
      `Invalid --db-name "${parsed.dbName}". Use lowercase letters, digits and underscores, starting with a letter.`,
    );
  }

  return { ...parsed, mode: 'create', out: parsed.out ?? process.cwd() };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 8 new tests

- [ ] **Step 5: Commit**

```bash
git add tools/create/args.mjs tests/unit/args.test.mjs
git commit -m "feat(create): parse and validate CLI arguments"
```

---

## Task 3: Tree copy with binary detection and path substitution

**Files:**
- Create: `tools/create/copy.mjs`
- Test: `tests/unit/copy.test.mjs`

**Interfaces:**
- Consumes: `substitute`, `findUnresolved` from `tools/create/tokens.mjs`.
- Produces: `isBinary(buffer: Buffer): boolean`, `walk(root: string): AsyncGenerator<string>` yielding POSIX-style relative file paths, `class UnresolvedTokenError extends Error` (with `exitCode = 1` and `tokens: string[]`), `copyTree(srcRoot: string, destRoot: string, tokens: Record<string,string>): Promise<string[]>` returning the relative destination paths written.

- [ ] **Step 1: Write the failing test**

`tests/unit/copy.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { isBinary, walk, copyTree, UnresolvedTokenError } from '../../tools/create/copy.mjs';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'forge-copy-'));
}

test('isBinary detects a NUL byte and passes plain text', () => {
  assert.equal(isBinary(Buffer.from('hello world')), false);
  assert.equal(isBinary(Buffer.from([0x68, 0x00, 0x69])), true);
});

test('isBinary only inspects the first 8 KiB', () => {
  const buffer = Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0x00])]);
  assert.equal(isBinary(buffer), false);
});

test('walk yields nested files as posix relative paths', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'a', 'b'), { recursive: true });
  await fs.writeFile(path.join(dir, 'root.txt'), 'x');
  await fs.writeFile(path.join(dir, 'a', 'b', 'deep.txt'), 'y');
  const found = [];
  for await (const rel of walk(dir)) found.push(rel);
  assert.deepEqual(found.sort(), ['a/b/deep.txt', 'root.txt']);
});

test('copyTree substitutes in file contents', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'readme.md'), '# __FORGE_TITLE__');
  await copyTree(src, dest, { __FORGE_TITLE__: 'My App' });
  assert.equal(await fs.readFile(path.join(dest, 'readme.md'), 'utf8'), '# My App');
});

test('copyTree substitutes in path segments', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.mkdir(path.join(src, '__FORGE_NAME__-docs'), { recursive: true });
  await fs.writeFile(path.join(src, '__FORGE_NAME__-docs', '__FORGE_NAME__.md'), 'x');
  await copyTree(src, dest, { __FORGE_NAME__: 'my-app' });
  const written = await fs.readFile(path.join(dest, 'my-app-docs', 'my-app.md'), 'utf8');
  assert.equal(written, 'x');
});

test('copyTree copies binary files byte-for-byte without substituting', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  const bytes = Buffer.from([0x89, 0x50, 0x00, 0x5f, 0x5f]);
  await fs.writeFile(path.join(src, 'logo.png'), bytes);
  await copyTree(src, dest, { __FORGE_NAME__: 'my-app' });
  assert.deepEqual(await fs.readFile(path.join(dest, 'logo.png')), bytes);
});

test('copyTree fails when a forge token cannot be resolved', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'a.txt'), 'x __FORGE_MISSING__');
  await assert.rejects(
    () => copyTree(src, dest, { __FORGE_NAME__: 'my-app' }),
    (error) => {
      assert.ok(error instanceof UnresolvedTokenError);
      assert.deepEqual(error.tokens, ['__FORGE_MISSING__']);
      assert.equal(error.exitCode, 1);
      return true;
    },
  );
});

test('copyTree does not trip on non-forge dunder identifiers', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'a.js'), 'window.__NUXT__; __dirname;');
  await copyTree(src, dest, {});
  assert.equal(await fs.readFile(path.join(dest, 'a.js'), 'utf8'), 'window.__NUXT__; __dirname;');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `tools/create/copy.mjs`

- [ ] **Step 3: Write the implementation**

`tools/create/copy.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { substitute, findUnresolved } from './tokens.mjs';

const BINARY_SNIFF_BYTES = 8192;

/** A token survived substitution, so the output would be broken. Never emit it. */
export class UnresolvedTokenError extends Error {
  constructor(tokens, where) {
    super(`Unresolved token(s) in ${where}: ${tokens.join(', ')}`);
    this.name = 'UnresolvedTokenError';
    this.tokens = tokens;
    this.exitCode = 1;
  }
}

/** True when the buffer looks binary — a NUL byte in the first 8 KiB. */
export function isBinary(buffer) {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Yields every file under `root` as a posix-style path relative to it. */
export async function* walk(root, prefix = '') {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield* walk(root, rel);
    } else if (entry.isFile()) {
      yield rel;
    }
  }
}

/**
 * Copies `srcRoot` into `destRoot`, substituting tokens in text contents and in
 * path segments. Binary files are copied verbatim. Throws UnresolvedTokenError
 * rather than writing a file that still contains a forge token.
 */
export async function copyTree(srcRoot, destRoot, tokens) {
  const written = [];

  for await (const rel of walk(srcRoot)) {
    const destRel = substitute(rel, tokens);

    const leftoverInPath = findUnresolved(destRel);
    if (leftoverInPath.length > 0) throw new UnresolvedTokenError(leftoverInPath, `path "${rel}"`);

    const buffer = await fs.readFile(path.join(srcRoot, rel));
    const destAbs = path.join(destRoot, destRel);
    await fs.mkdir(path.dirname(destAbs), { recursive: true });

    if (isBinary(buffer)) {
      await fs.writeFile(destAbs, buffer);
    } else {
      const output = substitute(buffer.toString('utf8'), tokens);
      const leftover = findUnresolved(output);
      if (leftover.length > 0) throw new UnresolvedTokenError(leftover, rel);
      await fs.writeFile(destAbs, output);
    }

    written.push(destRel);
  }

  return written;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 8 new tests

- [ ] **Step 5: Commit**

```bash
git add tools/create/copy.mjs tests/unit/copy.test.mjs
git commit -m "feat(create): copy trees with token and binary handling"
```

---

## Task 4: Adopt-mode subset matching and never-overwrite copy

Implements spec §7 adopt mode and discriminating test **D4**.

**Files:**
- Create: `tools/create/subset.mjs`
- Test: `tests/unit/subset.test.mjs`

**Interfaces:**
- Consumes: `walk`, `isBinary`, `UnresolvedTokenError` from `copy.mjs`; `substitute`, `findUnresolved` from `tokens.mjs`.
- Produces: `PROCESS_SUBSET: string[]`, `inSubset(rel: string): boolean`, `copySubset(srcRoot, destRoot, tokens): Promise<{written: string[], skipped: string[]}>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/subset.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inSubset, copySubset } from '../../tools/create/subset.mjs';

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'forge-subset-'));
}

test('inSubset accepts process files and rejects application code', () => {
  assert.equal(inSubset('CLAUDE.md'), true);
  assert.equal(inSubset('.claude/agents/planner.md'), true);
  assert.equal(inSubset('docs/standards/naming.md'), true);
  assert.equal(inSubset('docs/adrs/0000-template.md'), true);
  assert.equal(inSubset('docs/adrs/0001-single-source-documentation.md'), true);

  assert.equal(inSubset('package.json'), false);
  assert.equal(inSubset('apps/backend/src/main.ts'), false);
  assert.equal(inSubset('libs/core/src/shared/errors/DomainError.ts'), false);
  assert.equal(inSubset('docs/rfcs/README.md'), false);
});

test('copySubset writes only subset files and substitutes tokens', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.mkdir(path.join(src, '.claude/agents'), { recursive: true });
  await fs.writeFile(path.join(src, 'CLAUDE.md'), '# __FORGE_TITLE__');
  await fs.writeFile(path.join(src, '.claude/agents/planner.md'), 'plan for __FORGE_TITLE__');
  await fs.writeFile(path.join(src, 'package.json'), '{}');

  const result = await copySubset(src, dest, { __FORGE_TITLE__: 'My App' });

  assert.equal(await fs.readFile(path.join(dest, 'CLAUDE.md'), 'utf8'), '# My App');
  assert.deepEqual(result.written.sort(), ['.claude/agents/planner.md', 'CLAUDE.md']);
  await assert.rejects(() => fs.access(path.join(dest, 'package.json')));
});

test('copySubset never overwrites an existing file and reports it as skipped', async () => {
  const src = await tempDir();
  const dest = await tempDir();
  await fs.writeFile(path.join(src, 'CLAUDE.md'), '# __FORGE_TITLE__');
  await fs.writeFile(path.join(dest, 'CLAUDE.md'), 'ORIGINAL — DO NOT TOUCH');

  const result = await copySubset(src, dest, { __FORGE_TITLE__: 'My App' });

  assert.equal(await fs.readFile(path.join(dest, 'CLAUDE.md'), 'utf8'), 'ORIGINAL — DO NOT TOUCH');
  assert.deepEqual(result.skipped, ['CLAUDE.md']);
  assert.deepEqual(result.written, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `tools/create/subset.mjs`

- [ ] **Step 3: Write the implementation**

`tools/create/subset.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { walk, isBinary, UnresolvedTokenError } from './copy.mjs';
import { substitute, findUnresolved } from './tokens.mjs';

/**
 * The "how we work" layer, adoptable into a repository that already exists.
 * A trailing slash means "this directory and everything under it".
 */
export const PROCESS_SUBSET = [
  'CLAUDE.md',
  '.claude/agents/',
  '.claude/agent-memory/',
  'docs/standards/',
  'docs/adrs/0000-template.md',
  'docs/adrs/0001-single-source-documentation.md',
  'docs/adrs/0002-consolidated-agent-roster.md',
  'docs/adrs/0003-architecture-docs-describe-boundaries.md',
  'docs/adrs/0004-api-reference-lives-with-implementation.md',
];

export function inSubset(rel) {
  return PROCESS_SUBSET.some((entry) =>
    entry.endsWith('/') ? rel.startsWith(entry) : rel === entry,
  );
}

/**
 * Copies the process subset into an existing repository. Existing files are
 * never overwritten — they are reported so the caller can list them.
 */
export async function copySubset(srcRoot, destRoot, tokens) {
  const written = [];
  const skipped = [];

  try {
    for await (const rel of walk(srcRoot)) {
      if (!inSubset(rel)) continue;

      const destRel = substitute(rel, tokens);

      // Guard the path as well as the contents, exactly as copyTree does.
      const leftoverInPath = findUnresolved(destRel);
      if (leftoverInPath.length > 0) throw new UnresolvedTokenError(leftoverInPath, `path "${rel}"`);

      const destAbs = path.join(destRoot, destRel);

      const exists = await fs.access(destAbs).then(() => true, () => false);
      if (exists) { skipped.push(destRel); continue; }

      const buffer = await fs.readFile(path.join(srcRoot, rel));
      await fs.mkdir(path.dirname(destAbs), { recursive: true });

      if (isBinary(buffer)) {
        await fs.writeFile(destAbs, buffer);
      } else {
        const output = substitute(buffer.toString('utf8'), tokens);
        const leftover = findUnresolved(output);
        if (leftover.length > 0) throw new UnresolvedTokenError(leftover, rel);
        await fs.writeFile(destAbs, output);
      }

      written.push(destRel);
    }
  } catch (error) {
    // Adopt mode has no staging directory — it writes into the user's real
    // repository. Never roll back: deleting their files is worse than leaving
    // ours. Instead, tell them exactly what landed before the abort.
    error.written = written;
    error.skipped = skipped;
    throw error;
  }

  return { written, skipped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 3 new tests, including **D4**

- [ ] **Step 5: Commit**

```bash
git add tools/create/subset.mjs tests/unit/subset.test.mjs
git commit -m "feat(create): adopt the process subset without overwriting"
```

---

## Task 5: Receipt and git initialization

**Files:**
- Create: `tools/create/receipt.mjs`, `tools/create/git.mjs`
- Test: `tests/unit/receipt.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildReceipt({forgeCommit, mode, tokens}): object`, `forgeCommit(forgeRoot: string): Promise<string>`, `initRepo(dir: string, title: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/receipt.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt } from '../../tools/create/receipt.mjs';

test('buildReceipt records provenance and the tokens used', () => {
  const receipt = buildReceipt({
    forgeCommit: 'abc1234',
    mode: 'create',
    tokens: { __FORGE_NAME__: 'my-app' },
  });
  assert.equal(receipt.forgeCommit, 'abc1234');
  assert.equal(receipt.mode, 'create');
  assert.deepEqual(receipt.tokens, { __FORGE_NAME__: 'my-app' });
  assert.match(receipt.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildReceipt does not carry anything beyond the declared fields', () => {
  const receipt = buildReceipt({ forgeCommit: 'a', mode: 'adopt', tokens: {} });
  assert.deepEqual(Object.keys(receipt).sort(), ['forgeCommit', 'generatedAt', 'mode', 'tokens']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find `tools/create/receipt.mjs`

- [ ] **Step 3: Write the implementations**

`tools/create/receipt.mjs`:

```js
/** Provenance for a generated project. All values are non-secret by construction. */
export function buildReceipt({ forgeCommit, mode, tokens }) {
  return {
    forgeCommit,
    generatedAt: new Date().toISOString(),
    mode,
    tokens,
  };
}
```

`tools/create/git.mjs`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Short SHA of the forge checkout, or 'unknown' outside a git repository. */
export async function forgeCommit(forgeRoot) {
  try {
    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: forgeRoot });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/** Initializes a repository and makes the single initial commit. */
export async function initRepo(dir, title) {
  await run('git', ['init', '-q'], { cwd: dir });
  await run('git', ['add', '-A'], { cwd: dir });
  await run('git', [
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', `chore: initial commit for ${title}`,
  ], { cwd: dir });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 2 new tests

- [ ] **Step 5: Commit**

```bash
git add tools/create/receipt.mjs tools/create/git.mjs tests/unit/receipt.test.mjs
git commit -m "feat(create): write the provenance receipt and init git"
```

---

## Task 6: CLI orchestration against a fixture template

Wires the modules into a working command and proves the staging/atomic-rename and token-guard behaviour end to end. Implements discriminating test **D1**.

**Files:**
- Create: `tools/create/prompts.mjs`, `tools/create/index.mjs`
- Create: `tests/fixtures/mini-template/` (three files)
- Test: `tests/integration/create.test.mjs`

**Interfaces:**
- Consumes: `parseArgs`/`UsageError`, `deriveTokens`, `copyTree`/`UnresolvedTokenError`, `copySubset`, `buildReceipt`, `forgeCommit`/`initRepo`.
- Produces: `generate({argv, templateRoot, forgeRoot, interactive}): Promise<{target: string, mode: string, written: string[], skipped: string[]}>` — exported from `index.mjs` so tests drive it without spawning a process.

**Staging note (important):** stage inside the **parent of the target** (`<out>/.forge-staging-<random>`), never `os.tmpdir()`. `fs.rename` across filesystems fails with `EXDEV`, and the temp directory is frequently a different filesystem from the destination. Staging as a sibling guarantees the final move is a real atomic rename.

- [ ] **Step 1: Create the fixture template**

```bash
mkdir -p tests/fixtures/mini-template/docs/standards tests/fixtures/mini-template/.claude/agents
printf '# __FORGE_TITLE__\n\n__FORGE_DESCRIPTION__\n' > tests/fixtures/mini-template/CLAUDE.md
printf '{\n  "name": "__FORGE_NAME__",\n  "db": "__FORGE_DB_NAME__"\n}\n' > tests/fixtures/mini-template/package.json
printf 'Naming rules for __FORGE_TITLE__.\n' > tests/fixtures/mini-template/docs/standards/naming.md
printf 'Planner for __FORGE_TITLE__.\n' > tests/fixtures/mini-template/.claude/agents/planner.md
```

- [ ] **Step 2: Write the failing test**

`tests/integration/create.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'tests/fixtures/mini-template');

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'forge-create-'));
}

test('create mode generates a project with tokens substituted', async () => {
  const out = await tempDir();
  const result = await generate({
    argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });

  assert.equal(result.target, path.join(out, 'my-app'));
  assert.equal(
    await fs.readFile(path.join(out, 'my-app/CLAUDE.md'), 'utf8'),
    '# My App\n\n\n',
  );
  const pkg = JSON.parse(await fs.readFile(path.join(out, 'my-app/package.json'), 'utf8'));
  assert.equal(pkg.name, 'my-app');
  assert.equal(pkg.db, 'my_app');
});

test('create mode writes a forge.json receipt', async () => {
  const out = await tempDir();
  await generate({
    argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });
  const receipt = JSON.parse(await fs.readFile(path.join(out, 'my-app/forge.json'), 'utf8'));
  assert.equal(receipt.mode, 'create');
  assert.equal(receipt.tokens.__FORGE_NAME__, 'my-app');
});

test('create mode refuses a non-empty target and leaves no staging directory', async () => {
  const out = await tempDir();
  await fs.mkdir(path.join(out, 'my-app'), { recursive: true });
  await fs.writeFile(path.join(out, 'my-app/keep.txt'), 'existing');

  await assert.rejects(
    () => generate({
      argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
      templateRoot, forgeRoot, interactive: false,
    }),
    (error) => { assert.equal(error.exitCode, 2); return true; },
  );

  assert.deepEqual(await fs.readdir(path.join(out, 'my-app')), ['keep.txt']);
  const leftovers = (await fs.readdir(out)).filter((e) => e.startsWith('.forge-staging-'));
  assert.deepEqual(leftovers, []);
});

// D1 — an unresolvable token must fail the run and leave nothing behind
test('D1: an unresolved token fails generation and leaves nothing behind', async () => {
  const out = await tempDir();
  const brokenTemplate = await tempDir();
  await fs.writeFile(path.join(brokenTemplate, 'a.md'), 'x __FORGE_MISSING__');

  await assert.rejects(
    () => generate({
      argv: ['--name', 'my-app', '--out', out, '--yes', '--no-git'],
      templateRoot: brokenTemplate, forgeRoot, interactive: false,
    }),
    (error) => {
      assert.deepEqual(error.tokens, ['__FORGE_MISSING__']);
      assert.equal(error.exitCode, 1);
      return true;
    },
  );

  assert.deepEqual(await fs.readdir(out), []);
});

test('adopt mode copies only the process subset and skips existing files', async () => {
  const existing = await tempDir();
  await fs.writeFile(path.join(existing, 'CLAUDE.md'), 'MINE');

  const result = await generate({
    argv: ['--into', existing, '--yes'],
    templateRoot, forgeRoot, interactive: false,
  });

  assert.equal(result.mode, 'adopt');
  assert.equal(await fs.readFile(path.join(existing, 'CLAUDE.md'), 'utf8'), 'MINE');
  assert.deepEqual(result.skipped, ['CLAUDE.md']);
  assert.ok(result.written.includes('docs/standards/naming.md'));
  await assert.rejects(() => fs.access(path.join(existing, 'package.json')));
});

test('adopt mode derives the project name from the target directory', async () => {
  const parent = await tempDir();
  const existing = path.join(parent, 'billover');
  await fs.mkdir(existing);

  await generate({
    argv: ['--into', existing, '--yes'],
    templateRoot, forgeRoot, interactive: false,
  });

  assert.equal(
    await fs.readFile(path.join(existing, 'docs/standards/naming.md'), 'utf8'),
    'Naming rules for Billover.\n',
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot find `tools/create/index.mjs`

- [ ] **Step 4: Write the prompting module**

`tools/create/prompts.mjs`:

```js
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { NAME_RE, UsageError } from './args.mjs';

/**
 * Fills in whatever the flags did not provide.
 *
 * Prompting needs a real terminal. With `--yes`, a non-interactive caller, or a
 * stdin that is not a TTY (CI, piped input), a missing name is a usage error
 * rather than a prompt nobody can answer. A CLI whose exit codes are
 * contractual must never exit 0 having done nothing.
 *
 * `isTty` is injectable so the non-terminal path is testable without a subprocess.
 */
export async function collectAnswers(
  args,
  { interactive = true, isTty = Boolean(stdin.isTTY) } = {},
) {
  const answers = {
    name: args.name,
    title: args.title,
    scope: args.scope,
    description: args.description,
    dbName: args.dbName,
  };

  const canPrompt = interactive && !args.yes && isTty;

  if (answers.name || !canPrompt) {
    if (!answers.name) throw new UsageError('A project name is required (--name).');
    return answers;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  // Ctrl-D closes the interface without ever settling the pending question,
  // which would hang the process forever. Race the close against the answer.
  let finished = false;
  const closedEarly = new Promise((_, reject) => {
    rl.once('close', () => {
      if (!finished) reject(new UsageError('Input closed before a project name was given.'));
    });
  });
  const ask = (query) => Promise.race([rl.question(query), closedEarly]);

  try {
    while (!answers.name || !NAME_RE.test(answers.name)) {
      answers.name = (await ask('Project name (kebab-case): ')).trim();
      if (!NAME_RE.test(answers.name)) {
        stdout.write('  Use lowercase letters, digits and hyphens, starting with a letter.\n');
      }
    }
    answers.description ??= (await ask('One-line description (optional): ')).trim();
  } finally {
    finished = true;
    rl.close();
  }

  return answers;
}
```

- [ ] **Step 5: Write the orchestrator**

`tools/create/index.mjs`:

```js
#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs, UsageError } from './args.mjs';
import { deriveTokens, toTitle } from './tokens.mjs';
import { copyTree } from './copy.mjs';
import { copySubset } from './subset.mjs';
import { buildReceipt } from './receipt.mjs';
import { forgeCommit, initRepo } from './git.mjs';
import { collectAnswers } from './prompts.mjs';

class TargetConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TargetConflictError';
    this.exitCode = 2;
  }
}

async function isEmptyDir(dir) {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

async function createProject({ args, templateRoot, forgeRoot, interactive }) {
  const answers = await collectAnswers(args, { interactive });
  const tokens = deriveTokens(answers);
  const target = path.resolve(args.out, answers.name);

  if (!(await isEmptyDir(target))) {
    throw new TargetConflictError(
      `Target ${target} already exists and is not empty. Move it aside or choose another --name.`,
    );
  }

  // Stage as a sibling of the target so the final move is a real atomic rename.
  // os.tmpdir() is often a different filesystem, where fs.rename fails with EXDEV.
  await fs.mkdir(args.out, { recursive: true });
  const staging = await fs.mkdtemp(path.join(args.out, '.forge-staging-'));

  try {
    const written = await copyTree(templateRoot, staging, tokens);

    const receipt = buildReceipt({
      forgeCommit: await forgeCommit(forgeRoot),
      mode: 'create',
      tokens,
    });
    await fs.writeFile(path.join(staging, 'forge.json'), `${JSON.stringify(receipt, null, 2)}\n`);

    // No `fs.rm(target)` here on purpose. `isEmptyDir` above guarantees the
    // target is absent or empty, and rename() replaces an empty directory
    // atomically. Deleting first would open the exact delete-then-fail window
    // that staging-as-a-sibling exists to close.
    await fs.rename(staging, target);

    if (args.git) await initRepo(target, tokens.__FORGE_TITLE__);

    return { mode: 'create', target, written: [...written, 'forge.json'], skipped: [] };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Existence only — an existing but EMPTY directory is a valid adopt target. */
async function dirExists(dir) {
  return fs.access(dir).then(() => true, () => false);
}

async function adoptInto({ args, templateRoot, forgeRoot }) {
  const target = path.resolve(args.into);
  // Deliberately existence, not emptiness: `git init my-repo && forge --into my-repo`
  // is a legitimate flow, so only a MISSING target redirects to create mode.
  if (!(await dirExists(target))) {
    throw new TargetConflictError(`${target} does not exist — use create mode instead.`);
  }

  const name = args.name ?? path.basename(target);
  const tokens = deriveTokens({ name, title: args.title ?? toTitle(name) });
  const { written, skipped } = await copySubset(templateRoot, target, tokens);

  return { mode: 'adopt', target, written, skipped, forgeCommit: await forgeCommit(forgeRoot) };
}

/** Programmatic entry point — the CLI is a thin wrapper around this. */
export async function generate({ argv, templateRoot, forgeRoot, interactive = true }) {
  const args = parseArgs(argv);
  return args.mode === 'adopt'
    ? adoptInto({ args, templateRoot, forgeRoot })
    : createProject({ args, templateRoot, forgeRoot, interactive });
}

async function main() {
  const forgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const templateRoot = path.join(forgeRoot, 'template');

  try {
    const result = await generate({ argv: process.argv.slice(2), templateRoot, forgeRoot });

    if (result.mode === 'create') {
      process.stdout.write(`\nCreated ${result.target} (${result.written.length} files)\n\n`);
      process.stdout.write('Next steps:\n');
      process.stdout.write(`  cd ${result.target}\n  npm install\n  npm run dev:up\n\n`);
    } else {
      process.stdout.write(`\nAdopted the process layer into ${result.target}\n`);
      process.stdout.write(`  ${result.written.length} file(s) written\n`);
      if (result.skipped.length > 0) {
        process.stdout.write(`  ${result.skipped.length} left untouched (already present):\n`);
        for (const rel of result.skipped) process.stdout.write(`    ${rel}\n`);
      }
      process.stdout.write('\n');
    }
  } catch (error) {
    process.stderr.write(`\n${error.message}\n`);
    // copySubset attaches what it managed to write before aborting. Adopt mode
    // writes into a real repository and never deletes, so say what landed.
    if (Array.isArray(error.written) && error.written.length > 0) {
      process.stderr.write(`\n${error.written.length} file(s) were written before this failed:\n`);
      for (const rel of error.written) process.stderr.write(`    ${rel}\n`);
      process.stderr.write('Nothing was deleted. Review them before re-running.\n');
    }
    process.stderr.write('\n');
    if (error instanceof UsageError) {
      process.stderr.write('Usage:\n');
      process.stderr.write('  npm run create -- --name <kebab> [--title <s>] [--scope <@s>]\n');
      process.stderr.write('                    [--description <s>] [--db-name <s>] [--out <dir>]\n');
      process.stderr.write('                    [--no-git] [--yes]\n');
      process.stderr.write('  npm run create -- --into <existing-dir>\n\n');
    }
    process.exit(error.exitCode ?? 3);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS — 6 tests, including **D1**

- [ ] **Step 7: Verify the CLI works for a human**

```bash
rm -rf /tmp/forge-smoke && mkdir -p /tmp/forge-smoke
node tools/create/index.mjs --name demo-app --out /tmp/forge-smoke --yes --no-git 2>&1 || true
```

Expected: fails cleanly, because `template/` does not exist yet. The message must be readable, not a raw stack trace. Tasks 7–12 create `template/`.

- [ ] **Step 8: Commit**

```bash
git add tools/create/prompts.mjs tools/create/index.mjs tests/integration/create.test.mjs tests/fixtures/
git commit -m "feat(create): wire the CLI with staged, atomic generation"
```

---
## Task 7: Extract the standards, convention ADRs and docs skeleton

**Files:**
- Create: `template/docs/standards/*.md` (9 files), `template/docs/adrs/*.md` (5 files), `template/docs/{rfcs,architecture,guides,concepts,api}/README.md`, `template/docs/superpowers/{specs,plans}/.gitkeep`

**Interfaces:**
- Consumes: nothing.
- Produces: the authoritative docs every agent prompt points at. Task 8 links to `docs/standards/agent-playbook.md` and the ADR filenames listed below; keep those names exact.

- [ ] **Step 1: Copy the standards verbatim from Voku**

```bash
V=~/Progetti/Voku
T=~/Progetti/forge/template
mkdir -p "$T/docs/standards"
for f in README.md agent-playbook.md data-conventions.md formatting.md git.md i18n.md naming.md testing.md typing.md; do
  cp "$V/docs/standards/$f" "$T/docs/standards/$f"
done
```

- [ ] **Step 2: Find every Voku-specific reference**

```bash
cd ~/Progetti/forge
grep -rniE 'voku|\bevent\b|\bticket\b|\brsvp\b|invitation|\bpayment\b' template/docs/standards/
```

Expected: a handful of hits, concentrated in `naming.md` (≈4), `data-conventions.md` (≈2), `typing.md` (≈1), `git.md` (≈1).

- [ ] **Step 3: Rewrite each hit using the neutral example vocabulary**

Every illustrative example uses `Article` / `Comment` / `Tag`. Apply these mappings consistently — the point is that no reader can tell what product the standards came from:

| Voku example | Replacement |
|---|---|
| `Event`, `EventService`, `IEventService` | `Article`, `ArticleService`, `IArticleService` |
| `Ticket`, `TicketStatus` | `Comment`, `CommentStatus` |
| `Invitation`, `Rsvp` | `Tag`, `TagAssignment` |
| `Payment`, `Refund` | `Subscription` (only where a money example is needed) |
| `Voku`, `voku` | `__FORGE_TITLE__`, `__FORGE_NAME__` |
| `@voku/core` | `__FORGE_SCOPE__/core` |

Rules while rewriting:
- Keep every rule's substance identical. Only the nouns change.
- `agent-playbook.md` references `../adrs/0009-consolidate-agent-roster.md` and `../adrs/0008-documentation-as-submodule.md`. Repoint them to `../adrs/0002-consolidated-agent-roster.md` and `../adrs/0001-single-source-documentation.md`.
- `agent-playbook.md` mentions `libs/core` (`@voku/core`) — becomes `__FORGE_SCOPE__/core`.
- Do not invent new rules. This is a rename pass, not an authoring pass.

- [ ] **Step 4: Verify the standards are clean**

```bash
cd ~/Progetti/forge
grep -rniE 'voku|\bevent\b|\bticket\b|\brsvp\b|invitation|\bpayment\b' template/docs/standards/ && echo "STILL DIRTY" || echo "CLEAN"
```

Expected: `CLEAN`

- [ ] **Step 5: Copy the ADR template and write the four convention ADRs**

```bash
V=~/Progetti/Voku
T=~/Progetti/forge/template
mkdir -p "$T/docs/adrs"
cp "$V/docs/adrs/0000-template.md" "$T/docs/adrs/0000-template.md"
# NOTE: do NOT copy Voku's docs/adrs/README.md — its index lists all 18 of that
# project's real ADRs (Stripe, refunds, guest auth), which is itself a major trace.
# Write a fresh README.md indexing only the five template ADRs (0000 + 0001-0004).
```

Then write four ADRs, each following `0000-template.md`'s structure, each sourced from the Voku ADR named below but rewritten as a **template default the project inherits and may supersede** — not as a decision someone else made about a different product:

| New file | Source | Decision it records |
|---|---|---|
| `0001-single-source-documentation.md` | Voku ADR-0008 | Shared rules live once in `docs/standards/*`; `CLAUDE.md`/`STANDARDS.md`/agent prompts point at them and never restate them. **Docs win on conflict.** |
| `0002-consolidated-agent-roster.md` | Voku ADR-0009 | One roster in the root `.claude/agents/`, one lifecycle in `docs/standards/agent-playbook.md`; framework-specific behaviour lives in each package, not in a forked roster. |
| `0003-architecture-docs-describe-boundaries.md` | Voku ADR-0010 | Architecture docs describe boundaries and link to `libs/core`; they never restate its shapes, because the executable contract is the truth. |
| `0004-api-reference-lives-with-implementation.md` | Voku ADR-0013 | API reference documentation lives beside the code that implements it, so it cannot drift independently. |

Each ADR's Status is `Accepted`, dated the day the template was created, with a Context section that says explicitly: *"This is a Forge template default. Supersede it with a new ADR if this project needs something different."*

Read each Voku source ADR first (`cat ~/Progetti/Voku/docs/adrs/0008-documentation-as-submodule.md` and the others) so the rationale carries across. Do not copy Voku's submodule/monorepo history — ADR-0008's *surviving rule* is the single-source principle, not the submodule mechanism.

- [ ] **Step 6: Create the remaining docs skeleton**

```bash
T=~/Progetti/forge/template
mkdir -p "$T"/docs/{rfcs,architecture,guides,concepts,api} "$T"/docs/superpowers/{specs,plans}
touch "$T"/docs/superpowers/specs/.gitkeep "$T"/docs/superpowers/plans/.gitkeep
```

Write a short `README.md` in each of the five directories stating what belongs there and what does not. Use these exactly:

- `docs/rfcs/README.md` — "Design proposals for features that span packages. An RFC describes **what** and **why** before code exists. Shapes and rules that end up executable belong in `libs/core`, not here."
- `docs/architecture/README.md` — "How the packages fit together: boundaries, data flow, deployment. Describes boundaries and links to `__FORGE_SCOPE__/core`; never restates its shapes (see ADR-0003)."
- `docs/guides/README.md` — "Task-oriented walkthroughs for humans: how to add a domain, how to run migrations, how to add a page. Narrative, verified, and owned by the `documenter` agent."
- `docs/concepts/README.md` — "Mental models a newcomer needs before the code makes sense. One concept per file."
- `docs/api/README.md` — "API reference lives beside its implementation (ADR-0004). This directory holds only cross-cutting API conventions: error shape, pagination, versioning."

- [ ] **Step 7: Verify Voku is untouched**

```bash
git -C ~/Progetti/Voku status --porcelain | wc -l   # must be 0
git -C ~/Progetti/Voku rev-parse --short HEAD        # must be fdfdbde
```

- [ ] **Step 8: Commit**

```bash
git add template/docs
git commit -m "feat(template): add standards, convention ADRs and docs skeleton"
```

---

## Task 8: Extract and generalize the agent roster

**Files:**
- Create: `template/.claude/agents/*.md` (11 agents + `README.md`), `template/.claude/agent-memory/reviewer/.gitkeep`

**Interfaces:**
- Consumes: `template/docs/standards/agent-playbook.md` and the ADR filenames from Task 7.
- Produces: the roster referenced by `template/CLAUDE.md` (Task 9). The `reviewer` prompt expects a `## Review dimensions` table in each package's `STANDARDS.md` — Tasks 10, 11 and 12 must each supply one.

- [ ] **Step 1: Copy all eleven agents plus the roster README**

```bash
V=~/Progetti/Voku
T=~/Progetti/forge/template
mkdir -p "$T/.claude/agents" "$T/.claude/agent-memory/reviewer"
touch "$T/.claude/agent-memory/reviewer/.gitkeep"
for f in README planner reviewer documenter closer pr core-implementer core-tester \
         backend-implementer backend-tester webapp-implementer webapp-tester; do
  cp "$V/.claude/agents/$f.md" "$T/.claude/agents/$f.md"
done
```

- [ ] **Step 2: Apply the mechanical renames**

**Use `perl`, not `sed`.** BSD `sed` on macOS does not support `\b`: it exits 0 and changes
nothing, so the rename would silently no-op. `perl -pi -e` handles word boundaries correctly and
passes UTF-8 through untouched when the pattern and replacement are ASCII (the agent prompts
contain em dashes and `‖`).

```bash
cd ~/Progetti/forge/template/.claude/agents
perl -pi -e 's{\@voku/core}{__FORGE_SCOPE__/core}g' *.md
perl -pi -e 's{Voku monorepo}{__FORGE_TITLE__ monorepo}g' *.md
perl -pi -e 's{\bVoku\b}{__FORGE_TITLE__}g' *.md
perl -pi -e 's{\bvoku\b}{__FORGE_NAME__}g' *.md
grep -ric voku *.md | grep -v ':0' && echo "STILL DIRTY" || echo "CLEAN"
```

Expected: `CLEAN`

- [ ] **Step 3: Remove Voku domain references by hand**

```bash
cd ~/Progetti/forge
grep -rniE '\bevent\b|\bticket\b|\brsvp\b|invitation|\bpayment\b|stripe|organizer|guest' template/.claude/agents/
```

Rewrite every hit using the `Article` / `Comment` / `Tag` vocabulary from Task 7. `core-implementer.md` and `core-tester.md` carry the most (they name `IEventService`, `runIEventServiceContract`, `Event.ts`); these become `IArticleService`, `runIArticleServiceContract`, `Article.ts`. `webapp-tester.md` references RSVP flows and `pages/events/**` — replace with `pages/articles/**`.

Re-run the grep until it returns nothing.

- [ ] **Step 4: Rewrite `reviewer.md` for table-driven dimension discovery**

Voku's `reviewer` hardcodes its per-package checklists in the prompt. Replace that section with discovery. The prompt must instruct the agent to:

1. Run `git diff --name-only` from the workspace root.
2. Map each changed file to its owning package by longest path prefix among `libs/core`, `apps/backend`, `apps/webapp`.
3. For each touched package, read that package's `STANDARDS.md` and execute **only** the rows of its `## Review dimensions` table.
4. Emit one JSON verdict for the whole diff.

Keep from Voku's original: the JSON verdict shape, the "docs win on conflict" rule, "read-only, never modifies files", the severity vocabulary, and the `memory: project` frontmatter key. Delete the hardcoded B*/W*/K* checklists — they move into the package `STANDARDS.md` files in Tasks 10–12.

Add this sentence verbatim to the prompt so the mechanism is self-describing:

> Your dimensions are not listed here. Each package declares its own in its `STANDARDS.md` under `## Review dimensions`; read them at run time and execute only the rows belonging to packages the diff touched. If a package has no such table, report that as a finding.

- [ ] **Step 5: Update `README.md` and the playbook cross-references**

In `template/.claude/agents/README.md`:
- Retitle to `# __FORGE_TITLE__ — Agent Roster`.
- Keep the roster table, the core-first task-flow diagram, and the model assignments.
- Delete the "Phase 1" migration narrative — a generated project has no migration history.
- Replace the reviewer's hardcoded dimension list with one line: "Dimensions are discovered from each package's `STANDARDS.md` (`## Review dimensions`)."
- Repoint any ADR links to the Task 7 filenames.

- [ ] **Step 6: Verify the roster is clean and complete**

```bash
cd ~/Progetti/forge
ls template/.claude/agents/ | wc -l                                  # must be 12
grep -rniE 'voku|\bevent\b|\bticket\b|\brsvp\b|invitation|\bpayment\b' template/.claude/agents/ \
  && echo "STILL DIRTY" || echo "CLEAN"
for f in template/.claude/agents/*.md; do
  head -1 "$f" | grep -q '^---$' || echo "MISSING FRONTMATTER: $f"
done
grep -L 'model:' template/.claude/agents/*.md | grep -v README || true
```

Expected: `12`, `CLEAN`, no missing-frontmatter lines, and no agent (other than `README.md`) lacking a `model:` key.

- [ ] **Step 7: Verify Voku is untouched**

```bash
git -C ~/Progetti/Voku status --porcelain | wc -l   # must be 0
```

- [ ] **Step 8: Commit**

```bash
git add template/.claude
git commit -m "feat(template): add the generalized agent roster"
```

---

## Task 9: Workspace shell

**Files:**
- Create: `template/package.json`, `template/nx.json`, `template/tsconfig.base.json`, `template/eslint.config.base.mjs`, `template/.npmrc`, `template/.editorconfig`, `template/.gitignore`, `template/.env.example`, `template/compose.yaml`, `template/compose.prod.yaml`, `template/.github/workflows/ci.yml`, `template/CLAUDE.md`, `template/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the npm scripts every later task and test relies on — `build`, `test`, `lint`, `typecheck`, `affected`, `dev:up`, `dev:down`, `dev:reset`, `dev:migrate`. The compose services are named `postgres`, `backend`, `webapp`; Task 14's e2e depends on those exact names.

- [ ] **Step 1: Write the root package manifest**

`template/package.json`:

```json
{
  "name": "__FORGE_NAME__",
  "version": "0.0.0",
  "private": true,
  "description": "__FORGE_DESCRIPTION__",
  "workspaces": ["apps/*", "libs/*"],
  "scripts": {
    "build": "nx run-many -t build",
    "test": "nx run-many -t test",
    "lint": "nx run-many -t lint",
    "typecheck": "nx run-many -t typecheck",
    "affected": "nx affected -t lint test build typecheck",
    "dev:up": "docker compose up --build",
    "dev:down": "docker compose down",
    "dev:reset": "docker compose down -v",
    "dev:build": "docker compose build",
    "dev:logs": "docker compose logs -f",
    "dev:migrate": "docker compose exec backend npm run migration:run -w apps/backend",
    "prod:build": "docker compose -f compose.prod.yaml build",
    "prod:up": "docker compose -f compose.prod.yaml up --build",
    "prod:down": "docker compose -f compose.prod.yaml down"
  },
  "devDependencies": {
    "@stylistic/eslint-plugin": "^5.10.0",
    "nx": "^21.2.0"
  },
  "overrides": {
    "@nuxt/schema": "4.4.8"
  },
  "engines": {
    "node": ">=22 <23"
  }
}
```

- [ ] **Step 2: Write the NX configuration**

`template/nx.json`:

```json
{
  "$schema": "./node_modules/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": ["default"],
    "sharedGlobals": []
  },
  "targetDefaults": {
    "build": { "cache": true, "inputs": ["production", "^production"] },
    "test": { "cache": true, "inputs": ["default", "^production"] },
    "lint": { "cache": true },
    "typecheck": { "cache": true },
    "purity": { "cache": true }
  }
}
```

- [ ] **Step 3: Copy the shared configs from Voku**

```bash
V=~/Progetti/Voku
T=~/Progetti/forge/template
cp "$V/eslint.config.base.mjs" "$T/eslint.config.base.mjs"
cp "$V/.npmrc"                 "$T/.npmrc"
cp "$V/.editorconfig"          "$T/.editorconfig"
cp "$V/.gitignore"             "$T/.gitignore"
cp "$V/.dockerignore"          "$T/.dockerignore"
cp "$V/compose.yaml"           "$T/compose.yaml"
cp "$V/compose.prod.yaml"      "$T/compose.prod.yaml"
mkdir -p "$T/.github/workflows"
cp "$V/.github/workflows/ci.yml" "$T/.github/workflows/ci.yml"
```

Then edit each for the template:
- `compose.yaml` — services must be exactly `postgres`, `backend`, `webapp`. Replace every hardcoded database name, user, password and container name with `__FORGE_DB_NAME__` / `__FORGE_NAME__`. Remove any service that exists only for a Voku concern. The `postgres` service sets `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` **inline** as local dev credentials (this is what Voku does, and what makes the stack boot without a populated secret in `.env.example`).
- `compose.prod.yaml` — same service names, but every credential comes from the environment with **no default**: `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}`. A production run must fail loudly rather than fall back to a dev credential.
- `ci.yml` — keep the nx-affected job on Node 22. Rename the workflow to `CI`. Remove any Voku-specific step, secret reference or deployment job. It must run `npm ci`, then `npx nx affected -t lint typecheck test build --base=origin/main`.
- `.gitignore` — must include `node_modules/`, `dist/`, `.nuxt/`, `.output/`, `coverage/`, `.nx/`, `storybook-static/`, `.env`.
- `.npmrc` — keep `legacy-peer-deps=true`. The Nuxt/Storybook dependency graph does not resolve without it; omitting this file makes `npm install` fail with `ERESOLVE` at the Task 13 gate.

- [ ] **Step 4: Write the environment example**

`template/.env.example` — **values are empty or non-secret placeholders only**:

```
# Database (local development only — compose.yaml carries the matching dev credentials)
POSTGRES_DB=__FORGE_DB_NAME__
POSTGRES_USER=__FORGE_NAME__
DATABASE_URL=postgres://__FORGE_NAME__:__FORGE_NAME__@postgres:5432/__FORGE_DB_NAME__

# Backend
NODE_ENV=development
PORT=3000

# Webapp
NUXT_PUBLIC_API_BASE=http://localhost:3000
```

**Why there is no `POSTGRES_PASSWORD` here.** The postgres image refuses to initialize with an
empty password, so an empty value would break `npm run dev:up` and Task 14. Instead
`compose.yaml` carries fixed, obviously-local dev credentials inline (`POSTGRES_USER`,
`POSTGRES_PASSWORD` and `POSTGRES_DB` all set to `__FORGE_NAME__` / `__FORGE_DB_NAME__`), and the
`DATABASE_URL` above embeds the same credential so the backend can connect. `compose.prod.yaml`
reads every credential from the environment with **no default**, so nothing local leaks into a
production run.

- [ ] **Step 5: Write the root orientation file**

`template/CLAUDE.md`:

```markdown
# __FORGE_TITLE__

__FORGE_DESCRIPTION__

NX/npm-workspaces monorepo. This file is orientation only — it points, it does not restate
rules (see ADR-0001 on single-source docs).

## Packages

| Path           | What it is                                                              | Guidance                                               |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/backend` | NestJS REST API + TypeORM (PostgreSQL)                                  | `apps/backend/CLAUDE.md` → `apps/backend/STANDARDS.md` |
| `apps/webapp`  | Nuxt 4 / Vue 3 frontend                                                 | `apps/webapp/CLAUDE.md` → `apps/webapp/STANDARDS.md`   |
| `libs/core`    | Framework-agnostic domain: entities, `I*Service` contracts, conformance suites | `libs/core/CLAUDE.md` → `libs/core/STANDARDS.md` |
| `docs`         | ADRs, RFCs, architecture, shared standards                              | `docs/standards/` is authoritative                     |

## Canonical truth

- `libs/core` is the **executable contract** for the domain (entities + interfaces). Docs
  describe boundaries and link to it; they never restate its shapes (ADR-0003, ADR-0004).
- Shared, cross-package rules live once in `docs/standards/*` and
  `docs/standards/agent-playbook.md`. **Docs win on conflict** with any
  `CLAUDE.md`/`STANDARDS.md`/agent prompt.

## Working in the monorepo

- **Dev environment (containerized, Node 22):** `npm run dev:up` brings up backend + webapp +
  Postgres together; `npm run dev:down` / `npm run dev:reset` tear down. The host Node version
  is irrelevant — everything runs in containers.
- Build/test/lint/typecheck via NX: `npx nx <target> <project>` or
  `npx nx run-many -t <target>`.
- Agents live in `.claude/agents/`. Standard flow:
  `planner → core-implementer → [backend-implementer ‖ webapp-implementer] → [*-tester ‖ reviewer] → documenter → closer → pr`.

This project was generated by Forge. See `forge.json` for provenance.
```

- [ ] **Step 6: Write `template/README.md`**

A human-facing README: what `__FORGE_TITLE__` is (`__FORGE_DESCRIPTION__`), prerequisites (Docker, Node 22), quick start (`cp .env.example .env`, `npm install`, `npm run dev:up`, backend on `:3000`, webapp on `:3001`), the package table, and where the docs live. No Forge internals beyond one line pointing at `forge.json`.

- [ ] **Step 7: Verify no secrets and no Voku traces**

```bash
cd ~/Progetti/forge
grep -rE "sk_|pk_live|BEGIN .* PRIVATE KEY" template/ && echo "SECRET FOUND" || echo "NO SECRETS"
grep -rE "(SECRET|PASSWORD|TOKEN|API_KEY)=[^[:space:]]+" template/ && echo "POPULATED SECRET" || echo "NO POPULATED SECRETS"
grep -ri voku template/ && echo "STILL DIRTY" || echo "CLEAN"
```

Expected: `NO SECRETS`, `NO POPULATED SECRETS`, `CLEAN`.
Note the second grep matches only **non-empty** values, so `POSTGRES_PASSWORD=` in `.env.example` passes correctly.

- [ ] **Step 8: Commit**

```bash
git add template/
git commit -m "feat(template): add the workspace shell"
```

---

## Task 10: `libs/core` skeleton with structural purity

Implements discriminating tests **D2** (framework import fails lint) and **D14** (no transport vocabulary in core).

**Files:**
- Create: `template/libs/core/{package.json,tsconfig.json,tsconfig.build.json,tsconfig.spec.json,jest.config.js,eslint.config.mjs,project.json,CLAUDE.md,STANDARDS.md,README.md,CHANGELOG.md}`
- Create: `template/libs/core/src/shared/errors/{DomainError.ts,index.ts}`
- Create: `template/libs/core/src/shared/testing/{ConformanceExpect.ts,index.ts}`
- Create: `template/libs/core/src/shared/types/{Brand.ts,index.ts}`
- Create: `template/libs/core/scripts/check-purity.mjs`
- Test: `template/libs/core/tests/shared/errors/DomainError.spec.ts`

**Interfaces:**
- Consumes: `template/eslint.config.base.mjs` from Task 9.
- Produces: `DomainError` (abstract base every domain error extends), `ConformanceExpect` / `ConformanceRunner` (the runner-agnostic harness both apps drive conformance suites through), `Brand<T, B>`. Phase 2 builds `users/`, `identities/`, `auth/` on these.

- [ ] **Step 1: Copy the package scaffolding from Voku and strip the domains**

```bash
V=~/Progetti/Voku
T=~/Progetti/forge/template
mkdir -p "$T/libs/core/src/shared"/{errors,testing,types} "$T/libs/core/tests/shared/errors" "$T/libs/core/scripts"
for f in package.json tsconfig.json tsconfig.build.json tsconfig.spec.json jest.config.js CLAUDE.md STANDARDS.md README.md; do
  cp "$V/libs/core/$f" "$T/libs/core/$f"
done
```

Then edit:
- `package.json` — `"name": "__FORGE_SCOPE__/core"`. Keep `exports` **only** for `./shared/errors`, `./shared/testing` and `./shared/types`; delete every domain subpath. There is no bare root export.
- `tsconfig.json` — keep `verbatimModuleSyntax: true` and `strict: true`.
- `CHANGELOG.md` — create fresh with a single `## [Unreleased]` heading.
- `STANDARDS.md` — see Step 5.

- [ ] **Step 2: Write the shared primitives**

`template/libs/core/src/shared/errors/DomainError.ts`:

```ts
/**
 * Base class for every domain invariant violation.
 *
 * Callers catch broadly with `error instanceof DomainError` or narrowly with a
 * specific subclass. It is never thrown directly — always throw a subclass that
 * names the invariant that was violated.
 */
export abstract class DomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
```

`template/libs/core/src/shared/errors/index.ts`:

```ts
export * from './DomainError';
```

`template/libs/core/src/shared/testing/ConformanceExpect.ts`:

```ts
/**
 * The assertion surface a conformance suite is driven through.
 *
 * Suites are runner-agnostic: the same suite runs under one test runner in one
 * package and a different runner in another, because each package adapts its
 * own runner to this interface.
 */
export interface ConformanceExpect {
  /** Asserts strict equality. */
  equal<T>(actual: T, expected: T, message?: string): void;
  /** Asserts the value is truthy. */
  ok(value: unknown, message?: string): void;
  /** Asserts the operation rejects with an instance of `errorType`. */
  rejects(
    operation: () => Promise<unknown>,
    errorType: new (...args: never[]) => Error,
    message?: string,
  ): Promise<void>;
}

/** The grouping and assertion primitives a conformance suite needs from its host runner. */
export interface ConformanceRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void | Promise<void>): void;
  expect: ConformanceExpect;
}
```

`template/libs/core/src/shared/testing/index.ts`:

```ts
export type { ConformanceExpect, ConformanceRunner } from './ConformanceExpect';
```

`template/libs/core/src/shared/types/Brand.ts`:

```ts
declare const brand: unique symbol;

/**
 * Nominal typing for primitives, so an identifier of one kind cannot be passed
 * where another is expected even though both are strings at runtime.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
```

`template/libs/core/src/shared/types/index.ts`:

```ts
export type { Brand } from './Brand';
```

- [ ] **Step 3: Write the purity lint configuration**

`template/libs/core/eslint.config.mjs`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import houseStyle from '../../eslint.config.base.mjs';

/**
 * libs/core is the framework-agnostic domain. These packages are structurally
 * unreachable from it — the rule makes purity a guarantee rather than a review
 * item that can be skipped.
 */
const FRAMEWORK_PACKAGES = [
  'typeorm', 'typeorm/*',
  '@nestjs/*',
  'nuxt', 'nuxt/*', 'vue', 'vue/*', 'pinia',
  '@prisma/*',
  '@simplewebauthn/*',
  'otplib', 'express', 'argon2', 'bcrypt', 'jsonwebtoken',
];

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...houseStyle,
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['**/*.ts'],
    rules: {
      // The typescript-eslint variant is required: the base rule does not see
      // `import type` specifiers, which would leave a purity hole.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: FRAMEWORK_PACKAGES,
          message: 'libs/core is framework-agnostic — no framework or runtime-specific imports.',
        }],
      }],
    },
  },
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { sourceType: 'module' } },
);
```

- [ ] **Step 4: Write the prose-purity checker**

Lint catches imports. The purity rule also forbids *naming* transport specifics in prose, which only a text check can enforce.

`template/libs/core/scripts/check-purity.mjs`:

```js
#!/usr/bin/env node
/**
 * Core purity, prose edition.
 *
 * The purity rule forbids naming framework or transport specifics in libs/core —
 * in comments and TSDoc, not only in imports. Lint covers imports; this covers
 * the words. Lines containing a URL are exempt, since `https://` in a @see link
 * is a reference, not transport vocabulary.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve(import.meta.dirname, '..', 'src');

const FORBIDDEN = [
  ['jwt', /\bjwts?\b/i],
  ['cookie', /\bcookies?\b/i],
  ['http', /\bhttps?\b/i],
  ['nestjs', /nest\.?js|@nestjs/i],
  ['nuxt', /\bnuxt\b/i],
  ['vue', /\bvue\b/i],
  ['pinia', /\bpinia\b/i],
  ['typeorm', /\btypeorm\b/i],
  ['express', /\bexpress\b/i],
];

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && full.endsWith('.ts')) yield full;
  }
}

const violations = [];

for await (const file of walk(SRC)) {
  const lines = (await fs.readFile(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    if (line.includes('://')) return;
    for (const [word, pattern] of FORBIDDEN) {
      if (pattern.test(line)) {
        violations.push(`${path.relative(SRC, file)}:${index + 1}  ${word}  ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error('libs/core purity violations — core must not name its consumers:\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log('libs/core purity: clean');
```

Add to `template/libs/core/package.json` scripts: `"purity": "node ./scripts/check-purity.mjs"`, and add a matching `purity` target to `template/libs/core/project.json` so `nx run-many -t purity` picks it up.

- [ ] **Step 5: Write `STANDARDS.md` with its review-dimension table**

Start from Voku's `libs/core/STANDARDS.md` (already copied). Apply the Task 7 vocabulary mapping and repoint the ADR links. Replace the "Authoritative standards" table's RFC row with `docs/rfcs/` generally, since a generated project has no RFC yet.

Then append the table the `reviewer` agent discovers:

```markdown
## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| K1 | No framework or runtime imports | `npx nx run core:lint` reports `@typescript-eslint/no-restricted-imports` | blocking | STANDARDS.md — Framework purity |
| K2 | No transport vocabulary in prose | `npm run purity -w libs/core` exits non-zero | blocking | STANDARDS.md — Framework purity |
| K3 | Service contracts are `I`-prefixed | `grep -rn "export interface [^I]" src/*/contracts/` | blocking | STANDARDS.md — I-prefix contracts |
| K4 | Contracts speak in entities, not DTOs | review `src/*/contracts/*.ts` for shapes that are neither an entity, a create-input type, nor a JSON wire shape | blocking | STANDARDS.md — Entities, not DTOs |
| K5 | TSDoc on every export | `grep -rnB1 "^export " src/ \| grep -v "\*/"` | blocking | STANDARDS.md — TSDoc is definition-of-done |
| K6 | One symbol per file, PascalCase filename | file basename matches the exported symbol | warning | STANDARDS.md — File layout |
```

- [ ] **Step 6: Write the failing test**

`template/libs/core/tests/shared/errors/DomainError.spec.ts`:

```ts
import { DomainError } from '__FORGE_SCOPE__/core/shared/errors';

class ArticleTitleRequiredError extends DomainError {
  public constructor() {
    super('An article requires a title.');
  }
}

describe('DomainError', () => {
  it('lets callers catch narrowly by subclass', () => {
    expect(() => {
      throw new ArticleTitleRequiredError();
    }).toThrow(ArticleTitleRequiredError);
  });

  it('lets callers catch broadly by the base class', () => {
    try {
      throw new ArticleTitleRequiredError();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
    }
  });

  it('reports the subclass name, not the base name', () => {
    expect(new ArticleTitleRequiredError().name).toBe('ArticleTitleRequiredError');
  });

  it('carries the message it was constructed with', () => {
    expect(new ArticleTitleRequiredError().message).toBe('An article requires a title.');
  });
});
```

- [ ] **Step 7: Verify core passes its own gates**

These run inside a generated project, so verify via the Task 13 integration gate. For a fast local check, generate once by hand:

```bash
cd ~/Progetti/forge
rm -rf /tmp/forge-core-check && mkdir -p /tmp/forge-core-check
node tools/create/index.mjs --name checkapp --out /tmp/forge-core-check --yes --no-git
cd /tmp/forge-core-check/checkapp && npm install
npx nx lint core && npx nx typecheck core && npx nx test core && npm run purity -w libs/core
```

Expected: all four pass, four `DomainError` tests green, `libs/core purity: clean`.

- [ ] **Step 8: Verify D2 and D14 actually discriminate**

```bash
cd /tmp/forge-core-check/checkapp
# D2 — a framework import must fail lint
printf "import type { Repository } from 'typeorm';\nexport type R = Repository<unknown>;\n" \
  > libs/core/src/shared/types/Bad.ts
npx nx lint core && echo "D2 FAILED TO DISCRIMINATE" || echo "D2 OK"
rm libs/core/src/shared/types/Bad.ts

# D14 — transport vocabulary in prose must fail the purity check
printf "/** Returns the JWT for the session. */\nexport type Bad = string;\n" \
  > libs/core/src/shared/types/Bad.ts
npm run purity -w libs/core && echo "D14 FAILED TO DISCRIMINATE" || echo "D14 OK"
rm libs/core/src/shared/types/Bad.ts
```

Expected: `D2 OK` and `D14 OK`. If either prints `FAILED TO DISCRIMINATE`, the guard is decorative — fix it before continuing.

- [ ] **Step 9: Commit**

```bash
cd ~/Progetti/forge
git add template/libs
git commit -m "feat(template): add libs/core with structural purity enforcement"
```

---

## Task 11: `apps/backend` skeleton

**Files:**
- Create: `template/apps/backend/{package.json,tsconfig.json,tsconfig.build.json,jest.config.ts,nest-cli.json,project.json,eslint.config.mjs,Dockerfile,CLAUDE.md,STANDARDS.md,README.md,CHANGELOG.md}`
- Create: `template/apps/backend/src/{main.ts,app.module.ts}`
- Create: `template/apps/backend/src/common/` (filters, interceptors, pipes, types)
- Create: `template/apps/backend/src/health/{health.module.ts,health.controller.ts}`
- Create: `template/apps/backend/src/db/data-source.ts`, `src/db/migrations/.gitkeep`
- Create: `template/apps/backend/src/i18n/en/*.json`
- Test: `template/apps/backend/src/health/__tests__/health.controller.spec.ts`

**Interfaces:**
- Consumes: `__FORGE_SCOPE__/core` (Task 10).
- Produces: a NestJS application listening on `PORT` (default `3000`) with `GET /health` returning `200 {"status":"ok"}`. Task 14's Docker e2e polls exactly that endpoint. Phase 2 adds `auth/`, `identities/` and `users/` modules alongside `health/`.

- [ ] **Step 1: Copy the backend scaffolding from Voku**

```bash
V=~/Progetti/Voku
T=~/Progetti/forge/template
mkdir -p "$T/apps/backend/src"/{common,health/__tests__,db/migrations,i18n/en}
for f in package.json tsconfig.json tsconfig.build.json jest.config.ts nest-cli.json project.json eslint.config.mjs Dockerfile CLAUDE.md STANDARDS.md README.md; do
  cp "$V/apps/backend/$f" "$T/apps/backend/$f"
done
cp -R "$V/apps/backend/src/common/." "$T/apps/backend/src/common/"
cp "$V/apps/backend/src/main.ts" "$T/apps/backend/src/main.ts"
touch "$T/apps/backend/src/db/migrations/.gitkeep"
```

**Do not copy** `src/events`, `src/tickets`, `src/invitations`, `src/payments`, `src/users`, `src/auth`, `src/communications`, `src/generated`, `docs/`, `coverage/`, `dist/`, `node_modules/`, `package-lock.json`.

- [ ] **Step 2: Strip domain coupling from `common/`**

```bash
cd ~/Progetti/forge
grep -rniE 'voku|\bevent\b|\bticket\b|\brsvp\b|invitation|\bpayment\b|stripe|organizer|guest' template/apps/backend/src/common/
```

Delete any file under `common/` that exists solely for a Voku domain concern. Keep the genuinely cross-cutting pieces: the exception filter, the response/pagination interceptor, validation pipes, shared types and the i18n plumbing. Rewrite remaining references with the `Article` / `Comment` / `Tag` vocabulary. Re-run the grep until it is empty.

- [ ] **Step 3: Rename the package and rewrite `app.module.ts`**

`template/apps/backend/package.json` — `"name": "__FORGE_SCOPE__/backend"`, and a `"__FORGE_SCOPE__/core": "*"` dependency. Keep the `migration:run` / `migration:generate` scripts; repoint them at `src/db/data-source.ts`.

`template/apps/backend/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [],
        migrations: ['dist/db/migrations/*.js'],
        synchronize: false,
      }),
    }),
    HealthModule,
  ],
})
export class AppModule {}
```

`template/apps/backend/src/db/data-source.ts`:

```ts
import 'dotenv/config';
import { DataSource } from 'typeorm';

/** Used by the TypeORM CLI for generating and running migrations. */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/db/migrations/*.ts'],
  synchronize: false,
});
```

- [ ] **Step 4: Write the health module**

`template/apps/backend/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';

/** Liveness endpoint. The container healthcheck and the e2e smoke test poll this. */
@Controller('health')
export class HealthController {
  @Get()
  public check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

`template/apps/backend/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

- [ ] **Step 5: Write the failing test**

`template/apps/backend/src/health/__tests__/health.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { HealthController } from '../health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('reports ok', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 6: Write `STANDARDS.md` with its review-dimension table**

Start from Voku's `apps/backend/STANDARDS.md` (already copied). Apply the Task 7 vocabulary mapping, repoint ADR/RFC links, and delete every Voku-domain rule. Append:

```markdown
## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| B1 | Controllers hold no business logic | `grep -rn "Repository\|getRepository" src/**/*.controller.ts` | blocking | STANDARDS.md — Service/controller split |
| B2 | Every module follows the module/controller/service/dto layout | directory listing of the changed module | blocking | STANDARDS.md — Module layout |
| B3 | Entity change is accompanied by a migration | a changed `*.entity.ts` with no new file in `src/db/migrations/` | blocking | STANDARDS.md — Migrations |
| B4 | No `synchronize: true` anywhere | `grep -rn "synchronize: true" src/` | blocking | STANDARDS.md — Migrations |
| B5 | Request payloads are validated DTOs | `grep -rn "@Body()" src/` — each must reference a DTO class | blocking | STANDARDS.md — DTOs |
| B6 | Errors use the shared exception filter shape | `grep -rn "throw new HttpException" src/` | warning | STANDARDS.md — Error shape |
| B7 | User-facing strings are translated | `grep -rnE "'[A-Z][a-z]+ [a-z]+" src/**/*.service.ts` | warning | `docs/standards/i18n.md` |
```

- [ ] **Step 7: Verify the backend passes its own gates**

```bash
cd ~/Progetti/forge
rm -rf /tmp/forge-be-check && mkdir -p /tmp/forge-be-check
node tools/create/index.mjs --name checkapp --out /tmp/forge-be-check --yes --no-git
cd /tmp/forge-be-check/checkapp && npm install
npx nx lint backend && npx nx typecheck backend && npx nx test backend && npx nx build backend
```

Expected: all four pass.

- [ ] **Step 8: Commit**

```bash
cd ~/Progetti/forge
git add template/apps/backend
git commit -m "feat(template): add the NestJS backend skeleton"
```

---

## Task 12: `apps/webapp` skeleton

**Files:**
- Create: `template/apps/webapp/{package.json,tsconfig.json,nuxt.config.ts,tailwind.config.ts,vitest.config.ts,project.json,eslint.config.mjs,Dockerfile,CLAUDE.md,STANDARDS.md,README.md,CHANGELOG.md}`
- Create: `template/apps/webapp/app/{app.vue,pages/index.vue,assets/css/main.css}`
- Create: `template/apps/webapp/app/components/atoms/AppButton.vue`
- Create: `template/apps/webapp/stories/atoms/AppButton.stories.ts`
- Create: `template/apps/webapp/.storybook/{main.ts,preview.ts}`
- Create: `template/apps/webapp/app/locales/en.json`
- Test: `template/apps/webapp/app/test/AppButton.spec.ts`

**Interfaces:**
- Consumes: `__FORGE_SCOPE__/core` (Task 10); the backend's base URL via `NUXT_PUBLIC_API_BASE`.
- Produces: a Nuxt application on port `3001` rendering an index page. Phase 2 adds `app/services/`, `app/fetchers/`, `app/stores/` and the auth pages.

- [ ] **Step 1: Copy the webapp scaffolding from Voku**

```bash
V=~/Progetti/Voku
T=~/Progetti/forge/template
mkdir -p "$T/apps/webapp"/{app/{components/atoms,pages,assets/css,locales,test},stories/atoms,.storybook,public}
for f in package.json tsconfig.json nuxt.config.ts tailwind.config.ts vitest.config.ts project.json eslint.config.mjs Dockerfile CLAUDE.md STANDARDS.md README.md; do
  cp "$V/apps/webapp/$f" "$T/apps/webapp/$f"
done
cp "$V/apps/webapp/.storybook/main.ts"    "$T/apps/webapp/.storybook/main.ts"
cp "$V/apps/webapp/.storybook/preview.ts" "$T/apps/webapp/.storybook/preview.ts"
```

**Do not copy** `app/pages/*` beyond what you write below, `app/composables/`, `app/fetchers/`, `app/stores/`, `app/services/`, `app/middleware/`, `stories/{molecules,organisms}/`, `storybook-static/`, `docs/`, `node_modules/`, `.nuxt/`, `.output/`, `package-lock.json`.

- [ ] **Step 2: Rename the package and clean the configs**

`template/apps/webapp/package.json` — `"name": "__FORGE_SCOPE__/webapp"`, with a `"__FORGE_SCOPE__/core": "*"` dependency. Keep the `dev`, `build`, `generate`, `preview`, `test`, `storybook` and `build-storybook` scripts.

`nuxt.config.ts` — set `devServer: { port: 3001 }`, `runtimeConfig.public.apiBase` from `NUXT_PUBLIC_API_BASE`, and the i18n locale directory. Remove any Voku-specific module, SEO default, analytics key or domain constant.

Then:

```bash
cd ~/Progetti/forge
grep -rniE 'voku|\bevent\b|\bticket\b|\brsvp\b|invitation|\bpayment\b|stripe|organizer' template/apps/webapp/
```

Rewrite every hit with the `Article` / `Comment` / `Tag` vocabulary; re-run until empty.

- [ ] **Step 3: Write the application shell**

`template/apps/webapp/app/app.vue`:

```vue
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
```

`template/apps/webapp/app/pages/index.vue`:

```vue
<script setup lang="ts">
const { t } = useI18n();

useHead({ title: t('home.title') });
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
    <h1 class="text-3xl font-semibold">
      {{ t('home.title') }}
    </h1>
    <p class="text-slate-600">
      {{ t('home.subtitle') }}
    </p>
  </main>
</template>
```

`template/apps/webapp/app/locales/en.json`:

```json
{
  "home": {
    "title": "__FORGE_TITLE__",
    "subtitle": "Generated by Forge. Replace this page with your application."
  },
  "common": {
    "submit": "Submit",
    "cancel": "Cancel"
  }
}
```

- [ ] **Step 4: Write one atom, its story and its test**

`template/apps/webapp/app/components/atoms/AppButton.vue`:

```vue
<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

const { variant = 'primary', disabled = false } = defineProps<Props>();

const classes = computed(() => ({
  'bg-slate-900 text-white hover:bg-slate-700': variant === 'primary',
  'bg-slate-100 text-slate-900 hover:bg-slate-200': variant === 'secondary',
}));
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50"
    :class="classes"
  >
    <slot />
  </button>
</template>
```

`template/apps/webapp/stories/atoms/AppButton.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppButton from '~/components/atoms/AppButton.vue';

const meta = {
  title: 'Atoms/AppButton',
  component: AppButton,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary'] },
    disabled: { control: 'boolean' },
  },
  render: (args) => ({
    components: { AppButton },
    setup: () => ({ args }),
    template: '<AppButton v-bind="args">Button</AppButton>',
  }),
} satisfies Meta<typeof AppButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary', disabled: false } };
export const Secondary: Story = { args: { variant: 'secondary', disabled: false } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
```

`template/apps/webapp/app/test/AppButton.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import AppButton from '../components/atoms/AppButton.vue';

describe('AppButton', () => {
  it('renders its slot content', () => {
    const wrapper = mount(AppButton, { slots: { default: 'Save' } });
    expect(wrapper.text()).toBe('Save');
  });

  it('applies the secondary variant classes', () => {
    const wrapper = mount(AppButton, { props: { variant: 'secondary' } });
    expect(wrapper.classes()).toContain('bg-slate-100');
  });

  it('is disabled when told to be', () => {
    const wrapper = mount(AppButton, { props: { disabled: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
  });
});
```

- [ ] **Step 5: Write `STANDARDS.md` with its review-dimension table**

Start from Voku's `apps/webapp/STANDARDS.md` (already copied). Apply the vocabulary mapping and delete Voku-domain rules. Append:

```markdown
## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| W1 | Component sits at the right atomic level | a `.vue` under `components/` whose imports contradict its level | blocking | STANDARDS.md — Atomic design |
| W2 | Components never call fetchers directly | `grep -rn "fetcher" app/components/` | blocking | STANDARDS.md — fetcher → composable → component |
| W3 | Tailwind tokens only, no arbitrary values | `grep -rnE "\[[0-9]+px\]" app/` | warning | STANDARDS.md — Tailwind tokens |
| W4 | No `any` or `never` escapes | `grep -rnE ": (any\|never)\b" app/` | blocking | `docs/standards/typing.md` |
| W5 | Every component has a story | a `.vue` under `components/` with no matching `stories/**/*.stories.ts` | warning | STANDARDS.md — Storybook |
| W6 | UI strings are translated, never inline | `grep -rnE ">[A-Z][a-z]+ " app/**/*.vue` | blocking | `docs/standards/i18n.md` |
| W7 | SSR pages set title and meta | a changed `pages/**/*.vue` with no `useHead`/`useSeoMeta` | warning | STANDARDS.md — SEO |
| W8 | Interactive elements are reachable and labelled | `grep -rn "@click" app/**/*.vue` on a non-button element | blocking | STANDARDS.md — Accessibility |
```

- [ ] **Step 6: Verify the webapp passes its own gates**

```bash
cd ~/Progetti/forge
rm -rf /tmp/forge-fe-check && mkdir -p /tmp/forge-fe-check
node tools/create/index.mjs --name checkapp --out /tmp/forge-fe-check --yes --no-git
cd /tmp/forge-fe-check/checkapp && npm install
npx nx lint webapp && npx nx typecheck webapp && npx nx test webapp && npx nx build webapp
```

Expected: all four pass, three `AppButton` tests green.

- [ ] **Step 7: Commit**

```bash
cd ~/Progetti/forge
git add template/apps/webapp
git commit -m "feat(template): add the Nuxt webapp skeleton"
```

---

## Task 13: Full generation gate

Proves the headline claim: a generated repository passes its own gates. Implements discriminating test **D5** as a hard gate.

**Files:**
- Create: `tools/sanitize.mjs`
- Test: `tests/integration/generated-project.test.mjs`
- Modify: `package.json` (add the `sanitize` script)

**Interfaces:**
- Consumes: `generate` from `tools/create/index.mjs`; the complete `template/` from Tasks 7–12.
- Produces: `npm run sanitize`, which exits non-zero on any Voku trace or populated secret.

- [ ] **Step 1: Write the sanitization gate**

`tools/sanitize.mjs`:

```js
#!/usr/bin/env node
/**
 * Extraction gate. The template must carry no trace of the project it was
 * extracted from, and no populated secret. Run before every commit that touches
 * template/, and in CI.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOTS = ['template', 'tools'];

const RULES = [
  ['source-project trace', /voku/i],
  ['source-domain term', /\b(rsvp|stripe)\b/i],
  ['stripe-style key', /\b(sk_|pk_live)/],
  // Only a POPULATED value is a finding — `POSTGRES_PASSWORD=` in .env.example is fine.
  ['populated secret', /(SECRET|PASSWORD|TOKEN|API_KEY)=\S+/],
  ['private key', /BEGIN [A-Z ]*PRIVATE KEY/],
];

async function* walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const findings = [];

for (const root of ROOTS) {
  for await (const file of walk(root)) {
    const buffer = await fs.readFile(file);
    if (buffer.includes(0)) continue;
    const lines = buffer.toString('utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [label, pattern] of RULES) {
        if (pattern.test(line)) findings.push(`${file}:${index + 1}  ${label}  ${line.trim()}`);
      }
    });
  }
}

if (findings.length > 0) {
  console.error('Sanitization failed:\n');
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(`\n${findings.length} finding(s).`);
  process.exit(1);
}

console.log('Sanitization: clean');
```

Add to `package.json` scripts: `"sanitize": "node tools/sanitize.mjs"`, and make `test:all` run it first:
`"test:all": "npm run sanitize && npm test && npm run test:integration"`.

- [ ] **Step 2: Write the failing integration test**

`tests/integration/generated-project.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'template');

async function generateProject() {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-gate-'));
  const { target } = await generate({
    argv: ['--name', 'gateapp', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });
  await run('npm', ['install'], { cwd: target, maxBuffer: 64 * 1024 * 1024 });
  return target;
}

test('a generated project passes every gate it ships with', async (t) => {
  const project = await generateProject();

  await t.test('lint', async () => {
    await run('npm', ['run', 'lint'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('typecheck', async () => {
    await run('npm', ['run', 'typecheck'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('test', async () => {
    await run('npm', ['run', 'test'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('build', async () => {
    await run('npm', ['run', 'build'], { cwd: project, maxBuffer: 64 * 1024 * 1024 });
  });
  await t.test('core purity', async () => {
    await run('npm', ['run', 'purity', '-w', 'libs/core'], { cwd: project });
  });
});

test('a generated project contains the whole process layer', async () => {
  const project = await generateProject();
  const expected = [
    'CLAUDE.md', 'README.md', 'forge.json', 'package.json', 'nx.json',
    'compose.yaml', '.env.example', '.github/workflows/ci.yml',
    '.claude/agents/planner.md', '.claude/agents/reviewer.md', '.claude/agents/README.md',
    'docs/standards/agent-playbook.md', 'docs/standards/naming.md',
    'docs/adrs/0001-single-source-documentation.md',
    'libs/core/src/shared/errors/DomainError.ts',
    'apps/backend/src/health/health.controller.ts',
    'apps/webapp/app/pages/index.vue',
  ];
  for (const rel of expected) {
    await fs.access(path.join(project, rel));
  }
  const agents = await fs.readdir(path.join(project, '.claude/agents'));
  assert.equal(agents.length, 12, 'expected 11 agents plus a README');
});

// D5 — no trace of the project the template was extracted from
test('D5: the template carries no source-project trace or populated secret', async () => {
  await run('node', ['tools/sanitize.mjs'], { cwd: forgeRoot });
});
```

- [ ] **Step 3: Run the tests**

Run: `npm run test:integration`
Expected: PASS. This takes several minutes — it runs a real `npm install` and four full NX targets per generated project.

- [ ] **Step 4: Confirm D5 discriminates**

```bash
cd ~/Progetti/forge
echo "built for voku" >> template/README.md
node tools/sanitize.mjs && echo "D5 FAILED TO DISCRIMINATE" || echo "D5 OK"
git checkout template/README.md
```

Expected: `D5 OK`

- [ ] **Step 5: Verify Voku is untouched**

```bash
git -C ~/Progetti/Voku status --porcelain | wc -l   # must be 0
git -C ~/Progetti/Voku rev-parse --short HEAD        # must be fdfdbde
```

- [ ] **Step 6: Commit**

```bash
git add tools/sanitize.mjs tests/integration/generated-project.test.mjs package.json
git commit -m "test(forge): gate on a generated project passing its own checks"
```

---

## Task 14: Docker end-to-end smoke test

**Files:**
- Test: `tests/integration/docker.test.mjs`

**Interfaces:**
- Consumes: `generate`; the compose service names `postgres`, `backend`, `webapp` from Task 9; `GET /health` from Task 11.
- Produces: nothing consumed by later tasks. This is the proof that `npm run dev:up` actually works.

- [ ] **Step 1: Write the failing test**

`tests/integration/docker.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { generate } from '../../tools/create/index.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const forgeRoot = path.resolve(here, '../..');
const templateRoot = path.join(forgeRoot, 'template');

const enabled = process.env.FORGE_E2E === '1';

async function waitForHealth(url, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`health never became ready: ${lastError?.message}`);
}

test('the generated stack boots and serves /health', { skip: !enabled && 'set FORGE_E2E=1' }, async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-docker-'));
  const { target } = await generate({
    argv: ['--name', 'dockerapp', '--out', out, '--yes', '--no-git'],
    templateRoot, forgeRoot, interactive: false,
  });

  await fs.copyFile(path.join(target, '.env.example'), path.join(target, '.env'));

  try {
    await run('docker', ['compose', 'up', '-d', '--build'], {
      cwd: target, maxBuffer: 64 * 1024 * 1024,
    });
    const body = await waitForHealth('http://localhost:3000/health');
    assert.deepEqual(body, { status: 'ok' });
  } finally {
    await run('docker', ['compose', 'down', '-v'], { cwd: target }).catch(() => {});
  }
});
```

- [ ] **Step 2: Run it**

```bash
cd ~/Progetti/forge
FORGE_E2E=1 npm run test:integration
```

Expected: PASS. First run builds images and is slow; that is why the test carries a 30-minute runner timeout and the health poll allows four minutes.

- [ ] **Step 3: Confirm it is skipped without the flag**

```bash
npm run test:integration 2>&1 | grep -i "set FORGE_E2E=1"
```

Expected: the skip reason appears, so the default suite needs no Docker.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/docker.test.mjs
git commit -m "test(forge): boot the generated stack and assert /health"
```

---

## Task 15: Forge's own CI, README and ADRs

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md`
- Create: `docs/adrs/{0000-template.md,0001-single-template-not-layers.md,0002-dependency-free-generator.md,0003-extraction-is-copy-out-only.md}`

**Interfaces:**
- Consumes: the `sanitize`, `test` and `test:integration` scripts.
- Produces: nothing. This task closes Phase 1.

- [ ] **Step 1: Write forge's CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm run sanitize
      - run: npm test

  generated-project:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm run test:integration

  docker:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm run test:integration
        env:
          FORGE_E2E: '1'
```

- [ ] **Step 2: Write forge's README**

Cover, in this order: what Forge is (one template, one generator); quick start (`npm run create -- --name my-app`); adopt mode (`npm run create -- --into ~/existing-repo`); what a generated project contains; how to change the template (edit `template/`, run `npm run test:all`); and the token reference table from spec §6.

- [ ] **Step 3: Write forge's own CLAUDE.md**

Point at the spec and this plan, state the three rules an agent working on Forge must not break: Voku is read-only, the generator takes no dependencies, and `npm run sanitize` must pass before any commit touching `template/`.

- [ ] **Step 4: Record the design decisions as forge ADRs**

Copy `template/docs/adrs/0000-template.md` to `docs/adrs/0000-template.md` and write three ADRs against it:

| File | Decision | Consequence to record |
|---|---|---|
| `0001-single-template-not-layers.md` | One template tree, copied wholesale; no layer composition | Adding a second stack means a second template or a fork — accepted, because mixing stacks is not a goal |
| `0002-dependency-free-generator.md` | The generator uses only Node builtins, tested with `node --test` | No YAML merging is possible, so any file needing composition must instead be wholly owned by the template |
| `0003-extraction-is-copy-out-only.md` | Voku is read-only; `npm run sanitize` gates every template commit | The template cannot track upstream Voku changes — accepted, this is a snapshot |

- [ ] **Step 5: Run the full suite one last time**

```bash
cd ~/Progetti/forge
npm run test:all
git -C ~/Progetti/Voku status --porcelain | wc -l   # must be 0
git -C ~/Progetti/Voku rev-parse --short HEAD        # must be fdfdbde
```

Expected: sanitize clean, all unit tests pass, all integration tests pass, Voku untouched.

- [ ] **Step 6: Commit**

```bash
git add .github README.md CLAUDE.md docs/adrs
git commit -m "docs(forge): add CI, README and the forge ADRs"
```

---

## Phase 1 Definition of Done

- [ ] `npm run create -- --name my-app --out ~/somewhere` produces a project that passes `lint`, `typecheck`, `test`, `build` and `purity`.
- [ ] `npm run create -- --into ~/existing-repo` adds the process layer and overwrites nothing.
- [ ] `FORGE_E2E=1 npm run test:integration` boots the stack and gets `{"status":"ok"}` from `/health`.
- [ ] `npm run sanitize` is clean.
- [ ] Discriminating tests **D1, D2, D4, D5, D14** are implemented and each has been observed to **fail** when its fault is injected.
- [ ] `git -C ~/Progetti/Voku status --porcelain` is empty and `HEAD` is still `fdfdbde`.

**Deferred to later phases:** D3 (conformance-suite discrimination) needs a real `I*Service` contract — Plan 2. D6–D13 and D15 are auth, tenancy and audit assertions — Plans 2–5.

## Next

Plan 2 — Identity foundation: `User`, `AuthIdentity` (password provider), `Session` with rotating refresh tokens, email verification, password reset, and the append-only audit log, with `IUserService`/`IAuthService` conformance suites driven by both apps.
