# Forge Phase 7 — The Closing Phase: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leave a repository in which nothing reads as incomplete — every ledgered finding
drained or shown already closed, every process document dissolved into ADRs, every carried
item closed or stated as a property of the software.

**Architecture:** Four workstreams in a forced order. The minors are drained first, while
the decision logs that hold their evidence still exist. The carried items are settled next,
so the documentation written afterwards describes what is true. The template's own
unfinished signals go third. The dissolution of `docs/superpowers/` is last, and its final
task deletes this plan and its own spec.

**Tech Stack:** Node 22 builtins (generator and `tests/`), NestJS 11 + TypeORM + PostgreSQL
(backend), Nuxt 4 + Vue 3 + Vitest (webapp), Jest (backend), nx targets
`test lint typecheck coverage purity layers build-storybook`.

**Spec:** `docs/superpowers/specs/2026-10-01-forge-phase-7-closing-design.md`

## Global Constraints

Copied verbatim from the spec §3. Every task's requirements implicitly include these.

- **`~/Progetti/Voku` is read-only.** Never write to it; never run a command there that could
  change tracked or untracked state. Before and after any task, confirm
  `git -C ~/Progetti/Voku status --porcelain` is empty and
  `git -C ~/Progetti/Voku rev-parse HEAD` is unchanged — it must still be
  `fdfdbdeae2891954dd1cac538a082d5837f281dd`. **Those two read-only commands are required,
  not forbidden.**
- **The generator takes no dependencies.** `tools/create/` and `tests/` use Node builtins
  only; the root `package.json` has no `dependencies` and no `devDependencies`.
- **`npm run sanitize` must pass before any commit touching `template/`.** Never weaken a
  rule to make a commit pass. Only Task 7 and Task 17 modify `tools/sanitize.mjs`.
- **The sanitize gate rejects Forge's process vocabulary inside `template/`.** Never write
  "Phase 5", "Phase 6", "Phase 7" or any phase coordinate into template prose.
- **Never add a foreign key to `audit_entries`**, in either direction.
- **`libs/core` stays framework-agnostic and transport-free, in prose as well as imports.**
  `grep -riE "\bjwt\b|cookie|http" template/libs/core/src` returns nothing.
- **ADR-0013 governs every mechanism choice.** Use the framework's own component; adapt it at
  its published extension point; record any departure beside the code.
- **State the invariant, not the enumeration.** A comment or document that counts rots
  silently. This phase cleans up four instances of exactly that defect. Do not add a fifth.
- **Verify module format before adopting any package.** `@nestjs/terminus` 12.x,
  `@nestjs/jwt` 12.x and `@nestjs/passport` 12.x are `"type": "module"`; the backend compiles
  to CommonJS and its Jest runner is CJS, so importing one fails before any test runs. Peer
  ranges and API shape are not evidence about module format. **Task 12 is the only task
  permitted to add a package, and it must probe first.**
- **`FORGE_E2E=1 npm test` runs the unit tier and nothing else.** The slow tiers are
  `npm run test:integration`.
- **`coverage` is a separate nx target and `libs/core` enforces 100%.** `-t test lint
  typecheck` passes while coverage fails. Any task touching `libs/core` runs
  `npx nx run core:coverage` before committing.
- **Docker headroom** is measured with `docker run --rm alpine df -h /`, never
  `docker system df`. Docker is available for this phase; the user has authorised its use.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Review Focus

Five failure modes the spec implies that no task's happy path exercises. Each has its test
named in the task that owns the code.

1. **A re-pointed citation names an ADR that does not say what the comment claims.** This
   ships a falsehood into every generated project and is the single largest risk in the
   phase. *Pinned by: Task 16's `adr-references.spec.ts`, which asserts every
   `docs/adrs/NNNN-*.md` path referenced anywhere under `template/` resolves to a file that
   exists.* The semantic half — that the ADR says the thing — is a reviewer's job, and Task
   16's brief says so.
2. **Deleting the three changelogs leaves dangling links** in template READMEs, `CLAUDE.md`
   files, or `docs/standards/git.md`, so a generated project ships documentation pointing at
   files it does not have. *Pinned by: Task 14's grep step and the same
   `adr-references.spec.ts` extended to relative markdown links under `template/`.*
3. **The completion grep is too narrow.** `grep "spec §" template/` passes while a citation
   was rewritten into a different stale form ("the spec says", "per the design doc").
   *Pinned by: Task 18's vocabulary sweep, which greps a list, not one pattern.*
4. **The rebuilt index page violates the atomic-design gate** it was exempted from, or breaks
   the Storybook build. *Pinned by: Task 13 running `npx nx run webapp:layers` and
   `build-storybook`, not only `test`.*
5. **An OpenAPI document, if wired, ships in production or breaks the CommonJS build.**
   *Pinned by: Task 12's composition-root assertion that the Swagger module is absent when
   `NODE_ENV=production`, plus the existing production e2e.*

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `docs/superpowers/MINORS.md` | Task 1's verified disposition of all 27 ledgered items. The input to Tasks 2–7. Deleted by Task 19 with the rest of the directory |
| `docs/adrs/0004-the-generator-contract.md` | What the generator promises: tokens, substitution, adopt mode, the `forge.json` receipt |
| `docs/adrs/0005-four-test-tiers.md` | Why the gates are tiered, and what a discriminating test is |
| `template/apps/backend/src/__tests__/adr-references.spec.ts` | Asserts every ADR path and relative doc link referenced under `template/` resolves |

**Deleted:**

| Path | Why |
|---|---|
| `template/apps/{backend,webapp}/CHANGELOG.md`, `template/libs/core/CHANGELOG.md` | Record Forge's history in files a generated project inherits as its own |
| `docs/superpowers/` (entire directory) | Dissolved into ADRs. Includes this plan and its spec |

**Modified (principal):** `CLAUDE.md`, `README.md`, `template/libs/core/README.md`,
`template/apps/webapp/app/pages/index.vue`, `template/apps/webapp/STANDARDS.md`,
`tools/sanitize.mjs`, `tools/refresh-lockfile.mjs`, `template/nx.json`,
`tests/integration/docker.test.mjs`, plus the files named per item in `MINORS.md`.

---

## Workstream A — drain the 27 minors

### Task 1: Verify every premise, and write the dispositions

**Why this task exists.** The ledger is demonstrably stale. Spot-checking six items before
this plan was written found **three already closed**: `storybook-config.spec.ts` now derives
its extension list from the glob and tests all five (P4#4); `auth-init.client.ts`'s TSDoc
already states that the `if`-guard and not `dependsOn` is load-bearing (P3#4); and P3#1's
stated premise — "`createApiClient` has no timeout" — is false, because
`DEFAULT_API_TIMEOUT_MS = 10_000` is applied through `AbortSignal.timeout` at
`fetchers/client.ts:199`. Writing fixes against premises nobody re-checked is how this
project has shipped false statements three times. **Check first.**

**Files:**
- Create: `docs/superpowers/MINORS.md`
- Read only: every file named in the spec's §4.1 and §4.2 tables

**Interfaces:**
- Produces: `docs/superpowers/MINORS.md` in the exact format given in Step 2. Tasks 2–7 read
  their items from it and implement only rows marked `OPEN`.

- [ ] **Step 1: Read the item list**

The 27 items, with their files and what each claims, are the two tables in the spec's §4.1
and §4.2. Read those tables. They are the complete list; do not add to it.

- [ ] **Step 2: Check each item against the code as it is today**

For each of the 27, open the named file and establish which of three states it is in:

- `OPEN` — the defect described is present as described.
- `CLOSED` — a later phase fixed it without updating the ledger. **Record the evidence**: the
  file, the line, and what is there now.
- `STALE` — the described defect is not what is there, but the finding points at something
  real with a different shape. **Record what is actually true.** P3#1 is this case.

Verify by reading, not by inference. An item whose file no longer exists is `CLOSED`.

- [ ] **Step 3: Write `docs/superpowers/MINORS.md`**

Exact format. One row per item, 27 rows, no omissions:

```markdown
# The 27 ledgered minors — verified dispositions

Checked against the tree at <commit sha>. Tasks 2 through 7 implement the `OPEN` rows and
nothing else. A `CLOSED` row needs no work; its evidence is why.

| Item | File | State | Evidence / what to do |
|---|---|---|---|
| P3#1 | `template/apps/webapp/app/plugins/auth-init.client.ts` | STALE | `DEFAULT_API_TIMEOUT_MS` bounds the renewal at `fetchers/client.ts:199`, so the "no timeout" premise is false. What remains open: <state it, or write CLOSED> |
| P3#4 | `template/apps/webapp/app/plugins/auth-init.client.ts` | CLOSED | The TSDoc's "The `if` is the belt to that brace and is what actually holds" is the sentence the finding asked for |
```

...and so on for all 27. The `Evidence / what to do` cell for an `OPEN` row must say
precisely what change closes it — a reader implementing that row must not need this file's
author.

- [ ] **Step 4: Check the count**

Run:

```bash
grep -c '^| P3#\|^| P4#' docs/superpowers/MINORS.md
```

Expected: `27`. Then confirm the three states sum to 27 and that every item number from the
spec's tables appears exactly once.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/MINORS.md
git commit -m "docs(phase-7): verified dispositions for the 27 ledgered minors

The ledger was stale. Checked every item against the tree rather than
trusting the tables, because at least three were already closed by later
phases without anyone updating the record.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Drain the webapp minors

**Files:**
- Modify: per `MINORS.md`, among `template/apps/webapp/app/plugins/auth-init.client.ts`,
  `app/composables/useInvitations.ts`, `app/services/oauth.service.ts`,
  `app/pages/account/identities.vue`, `app/test/storybook-config.spec.ts`
- Test: the corresponding `__tests__/` siblings

**Interfaces:**
- Consumes: `docs/superpowers/MINORS.md` rows P3#1, P3#4, P3#9, P4#4, P4#26, P4#27.

- [ ] **Step 1: Read your rows**

Read `docs/superpowers/MINORS.md` and take rows **P3#1, P3#4, P3#9, P4#4, P4#26, P4#27**.
Implement the `OPEN` ones. Skip `CLOSED` ones entirely — do not "improve" them.

- [ ] **Step 2: P3#9 — give `useInvitations.load` a status parameter**

If `OPEN`: `load` currently hardcodes `status: InvitationStatus.PENDING`. Add a parameter
that defaults to it, so an invitations-history view does not need to bypass the fetcher.
Change the signature in both the interface and the implementation:

```ts
/** Reads the list again, replacing what is held. Defaults to the open invitations. */
readonly load: (status?: InvitationStatus) => Promise<void>;
```

```ts
async function load(status: InvitationStatus = InvitationStatus.PENDING): Promise<void> {
```

and pass `status` through to `listInvitations`. Keep the existing comment, reworded: the
default is the contract, the parameter is the escape hatch. `invite` and `revoke` call
`load()` with no argument and keep their current behaviour.

- [ ] **Step 3: Write the test for P3#9**

In `template/apps/webapp/app/composables/__tests__/` beside the existing invitations tests
(create the file if there is none, matching the directory's naming):

```ts
it('reads the open invitations by default and the asked-for status when given one', async () => {
  const invitations = useInvitations();

  await invitations.load();
  expect(backend.lastInvitationFilter()).toBe(InvitationStatus.PENDING);

  await invitations.load(InvitationStatus.ACCEPTED);
  expect(backend.lastInvitationFilter()).toBe(InvitationStatus.ACCEPTED);
});
```

Use the fake backend this directory already uses; `lastInvitationFilter` stands for whatever
that fake exposes — read a sibling spec and follow it rather than inventing a helper.

- [ ] **Step 4: Run it red, then green**

```bash
cd template && npx nx run webapp:test
```

Expected before the change: FAIL on the second assertion (`load` ignores its argument, so the
filter stays `PENDING`). After: PASS.

- [ ] **Step 5: Implement the remaining OPEN rows**

- **P4#26** — one TSDoc line on `app/services/oauth.service.ts` saying why this service has
  no `domainErrorFor` when every sibling does.
- **P4#27** — `identities.vue`'s `onMounted` fires `load()` and `loadProviders()` with `void`,
  so neither rejection is handled. Await both (`await Promise.all([...])` inside an async
  `onMounted` callback) or handle rejection explicitly. Whichever: a rejected load must not
  become an unhandled rejection.
- **P3#1 / P3#4 / P4#4** — only if `MINORS.md` marks them `OPEN` or `STALE` with remaining
  work. P3#1 carries a design decision: if the conclusion is that the `await` stays, the
  close is the test showing the bound holds, not a code change.

- [ ] **Step 6: Run the webapp gates**

```bash
cd template && npx nx run-many -t test lint typecheck --projects=webapp
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add template/apps/webapp
git commit -m "fix(webapp): drain the carried webapp findings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Drain the core minors

**Files:**
- Modify: per `MINORS.md`, among
  `template/libs/core/tests/organizations/entities/Organization.spec.ts`,
  `template/libs/core/tests/organizations/entities/Membership.spec.ts`,
  `template/libs/core/src/identities/types/FederatedSignInInput.ts`

**Interfaces:**
- Consumes: `docs/superpowers/MINORS.md` rows P3#12, P3#13, P4#29.

These three are deletions and a one-liner, batched deliberately.

- [ ] **Step 1: P3#12 and P3#13 — delete the tautological round trips**

`Organization.spec.ts:92` and `Membership.spec.ts:64` each end a revive test with:

```ts
expect(revived.toJSON()).toEqual(original.toJSON());
```

Each is preceded by assertions that already check the revived instance's type and its date
fields. The trailing line restates what the file's own `toJSON` tests assert and cannot fail
independently of them. Delete both lines. Delete nothing else from either test.

- [ ] **Step 2: P4#29 — import the type the TSDoc links**

`FederatedSignInInput.ts` references `{@link User}` three times in the
`userWithMatchingEmail` doc block without importing `User`, so the links resolve to nothing.
House style is to import the type. Add:

```ts
import type { User } from '../../users/entities/User';
```

Verify that path against the tree before writing it — if `User` lives elsewhere, use where it
lives. If importing it would create a cycle or trip the purity gate, drop the `{@link }`
wrappers instead and leave the prose, and say in one clause why.

- [ ] **Step 3: Run the core gates, including coverage**

```bash
cd template && npx nx run-many -t test lint typecheck purity --projects=core && npx nx run core:coverage
```

Expected: PASS, with coverage still at 100%. **Coverage is the one that catches a deleted
assertion taking a branch's only cover with it** — this is the gate that a whole phase of
reviews missed last time.

- [ ] **Step 4: Commit**

```bash
git add template/libs/core
git commit -m "test(core): drain the carried core findings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Drain the backend minors

**Files:**
- Modify: per `MINORS.md`, among `template/apps/backend/src/audit/audit.service.ts`,
  `src/auth/guards/platform-admin.guard.ts`,
  `src/organizations/__tests__/organizations.service.spec.ts`,
  `src/db/__tests__/migration-sql.spec.ts`,
  `src/auth/oauth/entities/oauth-authorization-request.entity.ts`,
  `src/db/migrations/1758000004000-OAuthAuthorizationRequests.ts`

**Interfaces:**
- Consumes: `docs/superpowers/MINORS.md` rows P3#5, P3#6, P3#7, P3#8, P4#13, P4#14.

- [ ] **Step 1: P3#8 — make the audit assertion independent of the service's return**

`organizations.service.spec.ts`'s `records ORGANIZATION_CREATED against the organization it
created` asserts:

```ts
expect(entry.organizationId).toBe(created.id);
```

where `created` is `createOrganization`'s own return value. A service that returned an id it
failed to store would pass. Its update and delete siblings read the value back from the
store; do the same:

```ts
const stored = source.all(OrganizationRecord);
expect(stored).toHaveLength(1);
expect(entry.organizationId).toBe(stored[0].id);
```

- [ ] **Step 2: Watch it discriminate**

Temporarily make `createOrganization` return an id it did not store (for example
`{ ...organization, id: 'not-the-stored-one' as OrganizationId }`). Run:

```bash
cd template && npx nx run backend:test -- organizations.service
```

Expected: FAIL. Revert the mutation and re-run; expected PASS. **Record both outcomes in the
report** — an assertion nobody watched fail is not evidence.

- [ ] **Step 3: P3#7 — stop hand-building a `Principal`**

`audit.service.ts:243` constructs a `Principal` literal. `PrincipalService` is the one
hydrator and is where expiry runs. Use it, so the principal's shape is stated once.

If `PrincipalService` cannot serve this caller — it is in a different module, or hydrating
grants here would be work this decision never reads (the existing comment says `audit:read`
is answered by layers one and two alone) — then **do not force it**. Write the one-paragraph
reason beside the literal instead, naming what `PrincipalService` would add and why this
caller does not need it. A stated departure is a close; an unstated duplicate is not.

- [ ] **Step 4: P3#6 — tie the case-sensitivity to the tripwire**

The `platform:administer` refusal compares a literal. It is inert while `can()`'s layer three
is consumed by nothing, and
`template/apps/backend/src/__tests__/discriminating/d12-grant-revocation.spec.ts` already
holds a tripwire asserting exactly that — it scans the production source for a `can()` call
naming a record and goes red the day one appears.

Add a comment at the comparison pointing at that tripwire by file name, saying that when it
goes red this comparison is one of the things that becomes real. Do **not** make the
comparison case-insensitive: that would be a behaviour change to inert code, with no test
that could discriminate it.

- [ ] **Step 5: P3#5, P4#13, P4#14 — the stated-deliberateness items**

Each closes with prose, not code:

- **P3#5** — a paragraph in `migration-sql.spec.ts`'s TSDoc stating the split: which
  assertions run against `canonicalStatements` and which against raw source text, and why
  the second group is safe to write that way. The file already documents the normalizer at
  length; this states the boundary, which it does not.
- **P4#13** — `purpose!: string` on the authorization entity: type it to the union it
  actually holds, or state the deliberateness on the field, where a reader meets it, rather
  than only on the migration's column.
- **P4#14** — state the rule that selects which columns get `COMMENT ON` in migration
  `1758000004000`. If there is no rule and the selection was ad hoc, say that and either
  comment the rest or state the principle you are adopting.

- [ ] **Step 6: Run the backend gates**

```bash
cd template && npx nx run-many -t test lint typecheck --projects=backend
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add template/apps/backend
git commit -m "fix(backend): drain the carried backend findings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Drain the OAuth adapter minors

**Files:**
- Modify: per `MINORS.md`, among
  `template/apps/backend/src/auth/oauth/adapters/OidcOAuthProvider.ts`,
  `adapters/DevOAuthProvider.ts`, `adapters/__tests__/DevOAuthProvider.spec.ts`,
  `adapters/{GitHub,Google,Dev}OAuthProvider.ts`,
  `template/apps/backend/src/auth/oauth/__tests__/oauth.config.spec.ts`

**Interfaces:**
- Consumes: `docs/superpowers/MINORS.md` rows P4#3, P4#7, P4#8, P4#9, P4#15, P4#16.

- [ ] **Step 1: P4#7 — normalise the issuer's trailing slash**

`OidcOAuthProvider` concatenates `DISCOVERY_PATH` onto `OAUTH_OIDC_ISSUER_URL`. An issuer
configured as `https://issuer.example.com/` yields a double slash. Build the URL with the
`URL` constructor or strip one trailing slash before concatenating.

- [ ] **Step 2: Write the test for P4#7 — both spellings**

```ts
it('builds one discovery URL whether or not the issuer carries a trailing slash', () => {
  const withSlash = new OidcOAuthProvider({ ...config, issuerUrl: 'https://issuer.example.com/' });
  const without = new OidcOAuthProvider({ ...config, issuerUrl: 'https://issuer.example.com' });

  expect(withSlash.discoveryUrl).toBe('https://issuer.example.com/.well-known/openid-configuration');
  expect(withSlash.discoveryUrl).toBe(without.discoveryUrl);
});
```

Adapt the construction to the adapter's real constructor and the property or method that
exposes the discovery URL — read the file first. The assertion that matters is the second
one: the two spellings agree.

- [ ] **Step 3: Run it red, then green**

```bash
cd template && npx nx run backend:test -- OidcOAuthProvider
```

Expected before: FAIL on the trailing-slash case (double slash). After: PASS.

- [ ] **Step 4: P4#8 — assert the behaviour, not the source text**

`DevOAuthProvider.spec.ts` checks that the dev adapter makes no network call by searching its
own source for the literal `fetch(`. That passes for an adapter that calls `axios`, or
`globalThis.fetch`, or anything else. Replace it with a behavioural assertion: stub the global
`fetch` with a spy that throws if called, exercise the adapter's full flow, and assert the spy
was never called.

- [ ] **Step 5: Watch P4#8's new assertion discriminate**

Temporarily add a `await fetch('https://example.com')` to the dev adapter's authorize path.
Run the spec. Expected: FAIL. Revert; expected PASS. Record both.

- [ ] **Step 6: The remaining OPEN rows**

- **P4#3** — `expectOnlyRealAdapters` must assert the concrete class per slot, so a registry
  with the right shape and the wrong provider in the GITHUB slot fails.
- **P4#9** — `DevOAuthProvider`'s `consumed` map is unbounded. Evict expired entries on read
  (the entries are dead after the TTL anyway), or state the bound — development-only, ~43
  bytes per sign-in — and why it is acceptable. Either is a close.
- **P4#15** — `authorizationUrl` builds its query by string concatenation in the GitHub,
  Google and Dev adapters. Use `URLSearchParams` so a redirect URI carrying a query stops
  being a correctness precondition. If one adapter genuinely cannot, state the precondition
  at that site.
- **P4#16** — move the `PUBLIC_API_URL`-omission regression test out of the `describe` about
  the PF-1 collision and into its own.

- [ ] **Step 7: Run the backend gates**

```bash
cd template && npx nx run-many -t test lint typecheck --projects=backend
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add template/apps/backend/src/auth/oauth
git commit -m "fix(backend): drain the carried OAuth adapter findings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `build-storybook` declares its outputs

**Files:**
- Modify: `template/nx.json`

**Interfaces:**
- Consumes: `docs/superpowers/MINORS.md` row P4#24.

- [ ] **Step 1: Confirm where the build writes**

`build-storybook` runs `storybook build` in `apps/webapp`, which writes to
`storybook-static/` — `template/.gitignore:7` ignores exactly that path. Confirm it by
running the build once and listing the directory before changing anything.

- [ ] **Step 2: Declare it**

`targetDefaults["build-storybook"]` currently carries `cache: true` and `inputs`, but no
`outputs` — so nx caches the target and restores nothing, and a cache hit yields no built
site. Add:

```json
"build-storybook": {
  "cache": true,
  "inputs": ["production", "^production"],
  "outputs": ["{projectRoot}/storybook-static"]
}
```

- [ ] **Step 3: Prove the cache now restores the artifact**

```bash
cd template && npx nx run webapp:build-storybook && rm -rf apps/webapp/storybook-static && npx nx run webapp:build-storybook && ls apps/webapp/storybook-static
```

Expected: the second run reports a cache hit **and** the directory exists afterwards. Before
the change, the second run hits the cache and the directory stays missing — run it that way
first and record both outcomes.

- [ ] **Step 4: Commit**

```bash
git add template/nx.json
git commit -m "build: declare build-storybook's outputs so its cache restores the site

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Drain the sanitize-gate minors

**Files:**
- Modify: `tools/sanitize.mjs`
- Test: `tests/unit/sanitize.test.mjs`

**Interfaces:**
- Consumes: `docs/superpowers/MINORS.md` rows P4#19, P4#20, P4#21, P4#22, P4#23.

**This task owns `tools/sanitize.mjs` alone.** The five items edit one file's rules and must
leave the gate passing together. `tools/` takes no dependencies: Node builtins only, tested
with `node --test`.

- [ ] **Step 1: Write the failing tests first, all five**

In `tests/unit/sanitize.test.mjs`, following the file's existing helpers
(`pathFindings`, and whatever the content-rule equivalent is — read it first):

```js
test('digit-adjacent compounds are caught', () => {
  assert.notDeepEqual(contentFindings('const organizer1 = 1;'), []);
  assert.notDeepEqual(contentFindings('const x1organizer = 1;'), []);
});

test('consecutive-capital acronym compounds are caught', () => {
  assert.notDeepEqual(contentFindings('class APIOrganizerService {}'), []);
});

test('the gate scans itself', () => {
  const findings = scanFile('tools/sanitize.mjs');
  assert.deepEqual(findings.filter((f) => f.rule !== 'rule-definition'), []);
});
```

- [ ] **Step 2: Run them red**

```bash
node --test tests/unit/sanitize.test.mjs
```

Expected: FAIL on each new test.

- [ ] **Step 3: Widen the rules**

- **P4#19** — digit-adjacent boundaries (`organizer1`, `x1organizer`). The rule already
  handles camelCase/PascalCase boundaries; digits are the same kind of boundary.
- **P4#20** — consecutive-capital acronym compounds (`APIOrganizerService`), which the
  camelCase boundary logic misses because there is no lowercase-to-uppercase transition
  before `Organizer`.
- **P4#22** — the gate excludes itself from its own scan. Scan it. Its rule *definitions*
  legitimately contain the banned vocabulary, so give them the narrowest possible allowance —
  a single marked region or a named rule key — and **state in a comment what the allowance
  covers and why it cannot be wider**.

- [ ] **Step 4: P4#21 — the path-only rule**

The path-only `event|payment|ticket` rule was never widened because it needs basename
extraction plus a judgment about strictness. Make the judgment: extract the basename and
apply the same boundary handling the content rules use, **or** state in the rule's comment
why path-only matching is correct here and what a false negative would cost. Both are closes;
a silent third option is not.

- [ ] **Step 5: P4#23 — `tests/` is outside the gate's scope**

Two "the brief" instances live in `tests/`, which the gate does not scan by design. Either
bring `tests/` into scope, or state the exclusion and its reason in the gate's own TSDoc.
Prefer stating it: `tests/` is Forge's own, never shipped, and widening scope to it would
make the gate's own fixtures unwritable.

- [ ] **Step 6: Run the tests green, then the gate on the whole tree**

```bash
node --test tests/unit/sanitize.test.mjs && npm run sanitize
```

Expected: both PASS. **`npm run sanitize` passing on the whole tree is the gate on this
task** — a widened rule that now flags a legitimate string in `template/` must be narrowed
or the string changed, never the rule weakened back.

- [ ] **Step 7: Commit**

```bash
git add tools/sanitize.mjs tests/unit/sanitize.test.mjs
git commit -m "fix(sanitize): widen the compound rules, and scan the gate itself

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream C — settle the seven carried items

### Task 8: The concurrent double-enroll answers 409

**Files:**
- Modify: `template/apps/backend/src/mfa/webauthn/WebAuthnCeremonies.ts`
- Test: the WebAuthn enrolment spec under `template/apps/backend/src/mfa/webauthn/__tests__/`

**Interfaces:**
- Produces: nothing new. An existing domain error reaches an existing route in one more case.

Two simultaneous enrolments of one WebAuthn credential answer `500` instead of `409`. The
duplicate check runs before the write, so the unique index refuses the second insert after
the check has passed. **Correctness already holds** — the index does refuse it. Only the
error shape is wrong.

- [ ] **Step 1: Read the three things this task joins up**

- **The check:** `WebAuthnCeremonies.refuseDuplicateCredential(credentialId)` at
  `template/apps/backend/src/mfa/webauthn/WebAuthnCeremonies.ts:898` — a `findOne` followed by
  `throw new ConflictException('That security key is already registered.')`.
- **The index:** `uq_mfa_methods_webauthn_credential UNIQUE (webauthn_credential_id)`, declared
  in `template/apps/backend/src/db/migrations/1758000005000-Mfa.ts:105`.
- **The write:** the insert at `WebAuthnCeremonies.ts:707`, which sets
  `webauthnCredentialId: credential.id`.

**No new core error is needed.** The refusal already exists as a `ConflictException`; the race
simply has to produce the same one.

- [ ] **Step 2: Write the failing test**

Simulate the violation rather than racing two real requests — a race is not a test, it is a
coin flip. Make the insert reject with an error shaped like the real `pg` driver's:

```ts
it('answers the duplicate-credential conflict when the index refuses the insert', async () => {
  jest.spyOn(methods, 'insert').mockRejectedValueOnce(
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'uq_mfa_methods_webauthn_credential',
    }),
  );

  await expect(ceremonies.verify(ENROLLING_CALLER, VALID_RESPONSE)).rejects.toBeInstanceOf(
    ConflictException,
  );
});
```

Adapt the repository handle, the method name and the fixtures to what the file's existing
WebAuthn specs use — read a sibling test first. The assertion that matters is the error class.

- [ ] **Step 3: Run it red**

```bash
cd template && npx nx run backend:test -- WebAuthn
```

Expected: FAIL — the raw driver error escapes and surfaces as a 500.

- [ ] **Step 4: Catch `23505` on that one constraint**

Wrap the insert. Catch the error and throw the **same refusal `refuseDuplicateCredential`
throws** — extract that throw into a small private helper so there is one spelling of the
refusal, rather than a second `ConflictException` literal.

Guard on **both** the code and the constraint name:

```ts
const isDuplicateCredential = (error: unknown): boolean =>
  typeof error === 'object' && error !== null
  && (error as { code?: string }).code === '23505'
  && (error as { constraint?: string }).constraint === 'uq_mfa_methods_webauthn_credential';
```

A bare `code === '23505'` catch would swallow unrelated unique violations — the recovery-code
and challenge-token constraints are on neighbouring tables — and that is a defect, not a fix.

Add a comment stating the ADR-0013 reasoning: the database's own uniqueness guarantee is the
mechanism, and this maps its refusal onto the vocabulary the pre-write check already uses,
rather than reimplementing the check inside a transaction.

**Adjacent, if it is one line while you are in the file:** that `ConflictException` carries a
hardcoded English string, which `template/docs/standards/i18n.md` forbids for user-facing
text. If routing it through the i18n layer is a one-line change matching how neighbouring
refusals do it, make it. If it is not, leave it and name it in your report.

- [ ] **Step 5: Run it green, and run the filter spec**

```bash
cd template && npx nx run-many -t test lint typecheck --projects=backend
```

Expected: PASS. `ConflictException` is a Nest `HttpException`, so it already carries `409` and
the global filter passes it through — confirm that by asserting the status on the route, not
only the class in the service, so the test covers what a caller actually receives.

- [ ] **Step 6: Commit**

```bash
git add template/apps/backend/src/mfa
git commit -m "fix(mfa): a raced duplicate credential answers 409, not 500

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The real-Postgres confirm walk

**Files:**
- Modify: `tests/integration/docker.test.mjs`

**Interfaces:**
- Consumes: the container stack the file already brings up.

The MFA confirm leg is covered by the fake and not by the container tier. Enrolling and
confirming are one transaction — the confirmation and the first recovery batch commit
together — and only a real database can show that boundary holds.

- [ ] **Step 1: Measure headroom before building**

```bash
docker run --rm alpine df -h /
```

Never `docker system df`. Record the figure in the report.

- [ ] **Step 2: Read the file's existing walk style**

`docker.test.mjs` already walks real flows against the booted stack. Follow its existing
helpers for registering a user, signing in and calling authenticated routes — do not write a
second HTTP helper.

- [ ] **Step 3: Add the walk**

Register and sign in a user; enrol a TOTP method; compute a valid code from the returned
secret; confirm the method; then assert **both**:

1. `GET /mfa/methods` reports the method confirmed.
2. A recovery batch exists — the count of remaining codes is the full batch size.

The second assertion is the one that discriminates: a confirmation that committed without its
batch leaves an account with a second factor and no way back in, and assertion 1 alone cannot
see it.

- [ ] **Step 4: Run the Docker tier**

```bash
FORGE_E2E=1 npm run test:integration
```

**Not `FORGE_E2E=1 npm test`** — that runs the unit tier and nothing else. Expected: PASS.

- [ ] **Step 5: Watch it discriminate**

Temporarily make the confirm path skip issuing the batch. Re-run. Expected: FAIL on assertion
2. Revert, re-run, expected PASS. Record both.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/docker.test.mjs
git commit -m "test(e2e): confirm an enrolment against real Postgres, batch and all

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: What a throttled person is actually told

**Files:**
- Modify: whichever of `template/apps/webapp/app/locales/en.json`,
  `app/types/api.ts`, or the throttled pages the investigation in Step 1 names
- Test: the owning spec

**Check the premise before writing anything.** The roadmap recorded "a throttled person sees
the generic failure message", but the backend side already exists:
`http-exception.filter.ts:318` maps `TooManyAttemptsError` to `429` with
`messageKey: 'errors.common.too_many_attempts'` → "Too many attempts. Wait a moment and try
again", and `d16-throttle-refusal.spec.ts` asserts the code, a translated message **and** a
retry window on the response. The webapp's `ApiError` carries `body.message`.
`TooManyAttemptsError` carries `retryAfterSeconds`.

- [ ] **Step 1: Establish what a person actually sees**

For each route that can throttle, trace what the webapp renders on a `429`. Write the answer
in the report before changing anything. The likely finding is that the backend's message
arrives but **the retry window does not reach the person** — which is the part that turns a
dead end into a wait.

- [ ] **Step 2: Take the branch the finding dictates**

- **The message and the window already reach the person** → the item is closed by
  verification. Write the test that shows it. Change nothing else. Skip to Step 4.
- **The message arrives, the window does not** → surface the window. That is the whole change.
- **The path renders its own generic copy instead** → map the code, following whatever
  mechanism that path already uses; if it has none, follow the shape of
  `FEDERATED_REFUSAL_CODES`' message map rather than inventing a third mechanism.

- [ ] **Step 3: Keep it to one key and one entry**

One locale key and one mapping entry is the expected size. **If it grows past that, stop,
revert, and state the limitation in the root README's "Known limitations" instead** — a new
mechanism for one string is not a close, it is a new thing to maintain. Say in the report
which branch you took and why.

- [ ] **Step 4: Write the test**

Whatever the branch, the close is a test that a throttled response produces the message a
person sees, with the retry window in it if Step 2 put it there. Watch it red by removing the
mapping (or the window) and green by restoring it. Record both.

- [ ] **Step 5: Run the webapp gates and commit**

```bash
cd template && npx nx run-many -t test lint typecheck --projects=webapp
```

```bash
git add template/apps/webapp
git commit -m "fix(webapp): a throttled person is told how long to wait

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The development Storybook crash

**Files:**
- Modify: `template/apps/webapp/.storybook/` config, or `README.md`'s "Known limitations"

`storybook build` passes and is gated in CI. `storybook dev` is reported to crash. Nobody has
reproduced it inside a phase.

- [ ] **Step 1: Reproduce it**

```bash
cd template/apps/webapp && npx storybook dev -p 6006 --no-open
```

Capture the actual error. **If it does not crash, the item is closed by verification** — say
so in the report with the output, change nothing, and skip to Step 4.

- [ ] **Step 2: Fix it if the fix is bounded**

A version alignment, a Vite config entry, a missing alias — these are bounded. Make the fix,
then confirm **both** that `storybook dev` starts and serves, and that
`npx nx run webapp:build-storybook` still passes. A fix that breaks the gated build is not a
fix.

- [ ] **Step 3: State it if the fix is not bounded**

Add it to the root `README.md`'s existing "⚠️ Known limitations" section: what crashes, that
the build is the gate and is green, and what a developer does instead. **Do not delete the
`storybook` script to make the problem disappear.** A stated limitation is a closed item; a
removed capability is a different project.

- [ ] **Step 4: Commit**

```bash
git add template/apps/webapp README.md
git commit -m "fix(storybook): <what you did — fixed the dev server, or stated the limitation>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Probe `@nestjs/swagger`, then wire it or record it

**Files:**
- Modify: `template/apps/backend/package.json`, `src/main.ts`, `nest-cli.json`,
  `src/__tests__/composition-root.spec.ts` — **only on the CommonJS branch**
- Or: `README.md`'s "Known limitations" — on the ESM branch

**This is the only task permitted to add a package, and it must probe first.** The webapp's
service layer is written by hand against a contract that exists only as backend source; an
OpenAPI document is where the first drift would appear, and `@nestjs/swagger` is the
framework's own answer, so ADR-0013 points at it.

- [ ] **Step 1: Probe the module format**

Into a scratch directory **outside** `template/` (`npm install` fails inside it —
tokenised package names are invalid):

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null && npm install @nestjs/swagger@^11 --no-save 2>&1 | tail -3
cat node_modules/@nestjs/swagger/package.json | grep -E '"version"|"type"|"main"|"exports"' | head
```

`"type": "module"` with no CommonJS entry means ESM-only. **Report the literal output.** This
is the exact check Phase 6 skipped for `@nestjs/terminus`, which cost a task.

- [ ] **Step 2a: ESM-only → record it and stop**

Add to the root `README.md`'s "⚠️ Known limitations": the framework's own OpenAPI module is
ESM-only and the backend compiles to CommonJS, so no OpenAPI document ships; the backend
source is the contract. Do not work around it, do not vendor it, do not hand-write a schema.
Skip to Step 6.

- [ ] **Step 2b: CommonJS → wire it with the CLI plugin**

Add the dependency to `template/apps/backend/package.json`. Enable the **`@nestjs/swagger` CLI
plugin** in `nest-cli.json` so DTO schemas are inferred from TypeScript types — that is what
keeps this from becoming `@ApiProperty` on forty files:

```json
{
  "compilerOptions": {
    "plugins": ["@nestjs/swagger"]
  }
}
```

Merge into the existing `compilerOptions` rather than replacing it.

- [ ] **Step 3: Serve it outside production only**

In `main.ts`, build the document and mount it behind an explicit environment check:

```ts
if (process.env.NODE_ENV !== 'production') {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('__FORGE_TITLE__ API').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}
```

- [ ] **Step 4: Write the test that it is absent in production**

In `src/__tests__/composition-root.spec.ts` (or a sibling, matching the directory's style):

```ts
it('does not mount the API document in production', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const app = await bootstrapForTest();
    await request(app.getHttpServer()).get('/api/docs').expect(404);
  } finally {
    process.env.NODE_ENV = previous;
  }
});
```

Adapt `bootstrapForTest` to whatever the file already uses. Watch it red by removing the
environment guard, green by restoring it. Record both.

- [ ] **Step 5: Refresh the lockfile and run everything**

The template's lockfile cannot be refreshed in place — `npm install` rejects the tokenised
names. Use `tools/refresh-lockfile.mjs`, which copies out, substitutes placeholders, installs,
and reverse-substitutes. Then:

```bash
cd template && npx nx run-many -t test lint typecheck --projects=backend && cd .. && npm run sanitize
```

Expected: PASS. The backend README gains a line saying where the document is served.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(backend): <serve an OpenAPI document outside production | record that the framework's OpenAPI module is ESM-only>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream D — the template's own unfinished signals

### Task 13: Rebuild the index page from atoms, and delete its exemption

**Files:**
- Modify: `template/apps/webapp/app/pages/index.vue`,
  `template/apps/webapp/STANDARDS.md`, `template/apps/webapp/app/locales/en.json`
- Modify: `template/apps/webapp/CLAUDE.md` (its tree comment calls the page a placeholder)

`index.vue` ships raw `h1`/`p`, carries a comment telling the reader to delete it, and has a
**named exemption** in `STANDARDS.md` from the HTML-only-in-atoms rule. The component library
it was written before now has 33 atoms.

- [ ] **Step 1: Rebuild the page from atoms**

Compose from atoms that already exist — `AppContainer`, `AppSection`, `AppStack`,
`AppHeading`, `AppText`, `AppLink`. Read each one's props before using it. A minimal,
domain-free landing page that names the project and links to sign-in and register:

```vue
<script setup lang="ts">
const { t } = useI18n();

useHead({ title: t('home.title') });
</script>

<template>
  <AppContainer>
    <AppSection>
      <AppStack>
        <AppHeading>{{ t('home.title') }}</AppHeading>
        <AppText>{{ t('home.subtitle') }}</AppText>
        <AppStack>
          <AppLink to="/login">{{ t('home.signIn') }}</AppLink>
          <AppLink to="/register">{{ t('home.register') }}</AppLink>
        </AppStack>
      </AppStack>
    </AppSection>
  </AppContainer>
</template>
```

Adjust prop names and nesting to the real atoms. Keep it visually plain — it is a starting
point, not a marketing page. **Delete the file's leading exemption comment.**

- [ ] **Step 2: Update the copy**

In `app/locales/en.json`, `home.subtitle` currently reads "Generated by Forge. Replace this
page with your application." Reword it so it does not call the page a placeholder, and add
`home.signIn` and `home.register`. Every string the page renders goes through i18n — raw text
in a template is a standards violation here.

- [ ] **Step 3: Delete the STANDARDS exemption**

Remove the whole `**Exception — the generated placeholder page.**` bullet from
`template/apps/webapp/STANDARDS.md`. The rule now has no exceptions. Also fix
`template/apps/webapp/CLAUDE.md`'s tree comment, which calls `index.vue` a placeholder.

- [ ] **Step 4: Run the gates that enforce the rule you just un-exempted**

```bash
cd template && npx nx run-many -t test lint typecheck layers --projects=webapp && npx nx run webapp:build-storybook
```

Expected: PASS. **`layers` is the gate that enforces atomic design** and `build-storybook` is
the one that catches a broken import — running only `test` would miss both.

- [ ] **Step 5: Commit**

```bash
git add template/apps/webapp
git commit -m "feat(webapp): the index page composes from atoms, and the rule loses its exception

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Delete the three template changelogs

**Files:**
- Delete: `template/apps/backend/CHANGELOG.md`, `template/apps/webapp/CHANGELOG.md`,
  `template/libs/core/CHANGELOG.md`
- Modify: whatever Step 2's grep finds

They record **Forge's** build history inside files a generated project inherits as its own.
The webapp's says "No business domain, auth, fetchers, composables, or stores yet" — written
at Phase 1, with fifteen organisms and a full auth surface now shipping. `libs/core`'s is
three lines and empty. The backend's breaking note about recovery codes ends by excluding
fresh projects, and **every generated project is fresh**, so it is addressed to a reader who
cannot exist.

- [ ] **Step 1: Delete them**

```bash
git rm template/apps/backend/CHANGELOG.md template/apps/webapp/CHANGELOG.md template/libs/core/CHANGELOG.md
```

- [ ] **Step 2: Find and fix every reference**

```bash
grep -rn "CHANGELOG" template/ tools/ tests/ README.md CLAUDE.md 2>/dev/null | grep -v node_modules
```

Fix every hit: README tables, `CLAUDE.md` file trees, `docs/standards/git.md`'s release
practice, the generator's file manifest if it names them. **A link to a deleted file is
exactly the kind of incompleteness this phase exists to remove.**

- [ ] **Step 3: Confirm the generator still produces a complete project**

```bash
npm test && npm run sanitize
```

Expected: PASS. The generated-project tier builds a real project from the template; if
anything referenced a changelog by path, this is where it surfaces.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: drop the template changelogs — they record Forge's history, not the project's

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: `libs/core`'s README states the rule instead of listing the domains

**Files:**
- Modify: `template/libs/core/README.md`

It enumerates core's domains and names six — `shared/`, `users/`, `identities/`, `audit/`,
`organizations/`, `authorization/`. There are **eight**: `mfa/` and `auth/` postdate it. This
is the exact defect the global constraints forbid, shipping to every generated project.

- [ ] **Step 1: Confirm the gap**

```bash
ls template/libs/core/src/
```

Expected: eight directories. Compare against the README's prose.

- [ ] **Step 2: Rewrite the passage**

Replace the enumeration with the **rule that makes something a domain** — a bounded vocabulary
with its own entities, errors and policies, named in the domain's own words — and let the tree
be the list. Keep the paragraphs that follow it: the `shared/` boundary argument, why
`authorization/` is a domain rather than a member of `shared/`, and the contract-shape table.
Those state rules already and are not stale.

Also drop the word "skeleton" from the opening — it described a Phase 1 state.

- [ ] **Step 3: Check the rest of the file for other counts**

```bash
grep -nE "\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[0-9]+)\b" template/libs/core/README.md
```

Any surviving count is a statement that will rot. Rewrite each as an invariant, or verify it
and leave it only if it is structural (a contract genuinely has exactly two suites).

- [ ] **Step 4: Run sanitize and commit**

```bash
npm run sanitize
```

```bash
git add template/libs/core/README.md
git commit -m "docs(core): state what a domain is, rather than listing the ones that exist

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Workstream B — dissolve `docs/superpowers/`

### Task 16: Re-point the 50 in-template citations

**Files:**
- Modify: 41 files under `template/` — 23 in `apps/backend`, 18 in `libs/core`
- Create: `template/apps/backend/src/__tests__/adr-references.spec.ts`

Fifty comments and TSDoc blocks under `template/` cite "spec §N". They are copied into every
generated project, which never receives Forge's spec — **so each already points at nothing**,
independently of this phase.

**This is the largest surface in the phase for shipping a falsehood.** Phase 6's precedent:
three corrections each introduced a fresh inaccuracy. Verify every re-pointed citation against
the ADR's actual text.

- [ ] **Step 1: List them**

```bash
grep -rn "spec §\|Spec §" template/ | grep -v node_modules
```

Expected: 50 hits across 41 files.

- [ ] **Step 2: Re-point each one**

The mapping below is a starting point, **not an authority** — open the ADR and confirm it says
what the comment claims before citing it:

| Cited | Topic | Template ADR |
|---|---|---|
| §9.5 (16 hits) | `can()` and its three layers | `docs/adrs/0006-authorization-is-a-pure-function-in-core.md` |
| §9.4 (12) | organizations, roles, membership | `0007-tenancy-is-explicit-never-ambient.md`, `0010-organization-invitations.md` |
| §9.3 (6) | identity, providers, linking | `0005-identity-is-separate-from-user.md`, `0008-ports-not-vendors.md`, `0011-federated-identity-never-auto-links.md` |
| §9.6 (3) | audit log | `0009-two-database-roles.md` |
| §3.1, §4.2, §16.1, §11.2 (8) | MFA — these cite the *MFA design doc*, not the main spec | `0012-a-second-factor-is-a-property-of-the-account.md` |
| §8.4 (5) | the backend's directory listing | **No ADR.** It is a layout statement. Delete the citation or state the rule |
| §11 (1) | the discriminating tests | name the test file (`__tests__/discriminating/dNN-*.spec.ts`) directly |

Where an ADR covers the claim, cite it by **repository-relative path**, the way the existing
template ADR links are written. Where none does, **state the rule instead of citing
anything** — a citation into a document the reader does not have is worse than the sentence it
replaces.

- [ ] **Step 3: Confirm nothing is left**

```bash
grep -rn "spec §\|Spec §" template/ | grep -v node_modules
```

Expected: no output.

- [ ] **Step 4: Write the gate that keeps it true**

Create `template/apps/backend/src/__tests__/adr-references.spec.ts`:

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

/**
 * Every ADR a comment points at has to exist.
 *
 * A citation into a document the reader does not have is the defect this
 * guards: the template once cited the generator's own design spec, which no
 * generated project ever receives, so forty-one files pointed at nothing. The
 * ADRs under `docs/adrs/` DO ship, so citing one is safe — as long as it is
 * really there. This asserts that, and nothing else: whether the ADR says what
 * the comment claims is a reviewer's judgment, not a test's.
 */
const TEMPLATE_ROOT = resolve(__dirname, '../../../..');
const ADR_LINK = /docs\/adrs\/\d{4}-[a-z0-9-]+\.md/g;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|vue|md|json)$/.test(entry.name) ? [full] : [];
  });

describe('ADR references', () => {
  it('every ADR a file under the template points at exists', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(TEMPLATE_ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.match(ADR_LINK) ?? []) {
        if (!existsSync(join(TEMPLATE_ROOT, match))) missing.push(`${file} -> ${match}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

Resolve `TEMPLATE_ROOT` against the real depth of the spec file — count the directories, do
not trust the `../../../..` above. Extend the same walk to relative markdown links
(`](../...md)`) so Task 14's deleted changelogs cannot come back as dangling links.

- [ ] **Step 5: Watch the gate discriminate**

Temporarily add `// see docs/adrs/0099-does-not-exist.md` to any template source file. Run:

```bash
cd template && npx nx run backend:test -- adr-references
```

Expected: FAIL naming that file. Remove the line; expected PASS. Record both.

- [ ] **Step 6: Run everything, including coverage**

```bash
cd template && npx nx run-many -t test lint typecheck --projects=backend,core,webapp && npx nx run core:coverage && cd .. && npm run sanitize
```

Expected: PASS. **`libs/core` is touched by this task**, so coverage is not optional.

- [ ] **Step 7: Commit**

```bash
git add template
git commit -m "docs(template): cite the ADRs that ship, not a spec that does not

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: The two new ADRs, and the orientation rewrite

**Files:**
- Create: `docs/adrs/0004-the-generator-contract.md`, `docs/adrs/0005-four-test-tiers.md`
- Modify: `CLAUDE.md`, `README.md`, `tools/refresh-lockfile.mjs`, `tools/sanitize.mjs`

**Write these before Task 19 deletes their sources.** Both are drawn from
`docs/superpowers/specs/2026-09-17-forge-template-design.md`, which still exists while this
task runs.

- [ ] **Step 1: Write ADR-0004, the generator contract**

Follow `docs/adrs/0000-template.md`'s structure. Draw from spec §6 (tokens), §7 (the
generator) and §10 (generated project shape). Cover:

- The token set, and why it is exactly those tokens: a token exists where a generated project
  must differ, and nowhere else.
- Substitution as the only transform — ADR-0002's consequence made concrete. With no
  dependencies there is no YAML or JSON merging, so the generator copies and substitutes.
- Adopt mode as subset selection over the same tree, with never-overwrite as its safety
  property.
- **`forge.json` as a receipt.** It records the commit a project was generated from. Nothing
  reads it today. It exists because drift detection is the one tool that would need it and
  could not be added retroactively — a project generated without a receipt can never be
  diffed against its origin. **Writing this down is what stops the receipt reading as dead
  code**, which is the whole reason this ADR exists.

- [ ] **Step 2: Write ADR-0005, the four test tiers**

Draw from spec §11. Cover what each tier proves that the tier below it cannot — unit
(substitution logic), generated project (the output builds and passes its own gates),
storybook (the component library compiles), docker (the stack boots against real Postgres) —
and **what makes a discriminating test different from a unit test**: it is written to fail
against a plausible wrong implementation, not merely to pass against the right one. Name
D1–D16 as a set; the tests live in
`template/apps/backend/src/__tests__/discriminating/` and stay there.

Record the two traps, because they have each cost a phase: **`coverage` is a separate nx
target and `libs/core` enforces 100%**, and **`FORGE_E2E=1 npm test` runs the unit tier only**
— the slow tiers are `npm run test:integration`.

- [ ] **Step 3: Rewrite `CLAUDE.md`**

Its "authoritative documents" block names a spec and a Phase 1 plan that will not exist, and
asserts that "later phases (identity foundation, tenancy, authorization, audit) are planned
but not yet built" — false since Phase 3. Rewrite it around the five ADRs. **The three rules
an agent must not break are unchanged, verbatim.** The "Where things live" table loses its
`docs/superpowers/` row.

- [ ] **Step 4: Update the README's "More" table**

Drop the design-spec and phase-roadmap rows; add the two new ADRs. Nothing else in the README
changes here — Task 11 and Task 12 may have added to "Known limitations", and that is theirs.

- [ ] **Step 5: Fix the two already-dangling tool references**

- `tools/refresh-lockfile.mjs:10` cites `docs/superpowers/lockfile-report.md`. **That file
  does not exist and never did at that path.** Remove the citation or replace it with the
  explanation it was pointing at.
- `tools/sanitize.mjs:506` cites
  `.superpowers/sdd/2026-09-18-forge-phase-2-identity-foundation/task-17-report.md` §10.1 — a
  git-ignored execution workspace deleted at the end of Phase 2. Replace the citation with the
  reasoning itself.

- [ ] **Step 6: Verify no orientation file points into the doomed directory**

```bash
grep -rn "docs/superpowers" CLAUDE.md README.md tools/ tests/ template/ 2>/dev/null | grep -v node_modules
```

Expected: no output.

- [ ] **Step 7: Run the gates and commit**

```bash
npm test && npm run sanitize
```

```bash
git add docs/adrs CLAUDE.md README.md tools/
git commit -m "docs: two ADRs for what the spec was carrying, and orientation that is true

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 18: The vocabulary sweep

**Files:**
- Modify: whatever the sweep finds

The completion check `grep "spec §" template/` is too narrow: a citation rewritten into "the
spec says" or "per the design doc" would pass it. This task greps a **list**.

- [ ] **Step 1: Sweep the whole tree**

```bash
grep -rniE "\bnot yet\b|\bplanned\b|\bdeferred\b|\bfor now\b|coming soon|\bTODO\b|\bFIXME\b|\bTBD\b|in a future|later phase|the spec says|design doc|will be (added|built|implemented)" \
  --include="*.ts" --include="*.vue" --include="*.mjs" --include="*.json" --include="*.md" --include="*.yml" \
  . 2>/dev/null | grep -v node_modules | grep -v "^./docs/superpowers/" | grep -v package-lock.json
```

- [ ] **Step 2: Triage every hit**

Three legitimate categories survive, and only these:

- The word "stub" for a **test double** (`InMemoryAuthService`, `stub-User-1`), which is the
  codebase's own vocabulary.
- "placeholder" as the **HTML attribute** (`AppInput`, `AppTextarea`) and
  `tools/refresh-lockfile.mjs`'s substitution identities.
- A **rule forbidding** the thing (`STANDARDS.md`'s "never empty or a TODO",
  `reviewer.md`'s "STUBS / TODOs (do NOT flag)").

Everything else is closed or stated under the spec's §1 rule: either the work is done, or the
sentence is rewritten from a deferral into a property of the software.

- [ ] **Step 3: Handle §9.9 and §14's content**

The spec's "Still not included" and "Deferred" sections vanish with the directory, but the
*facts* need a home. Add one short paragraph to the root `README.md`'s "⚠️ Known limitations":
what Forge deliberately does not do — nested teams inside organizations, SAML/SCIM
provisioning, API keys and machine-to-machine tokens, per-field permissions, self-service
billing — **written as scope, not as backlog. No "yet", no "planned", no phase coordinate.**

`forge update` is covered by ADR-0004. Publishing to npm needs no record: it is an action
nobody has taken, not a gap in the software.

- [ ] **Step 4: Re-run the sweep**

Expected: only the three legitimate categories remain. List them in the report so a reviewer
can check the judgment.

- [ ] **Step 5: Run everything and commit**

```bash
npm test && npm run sanitize && FORGE_E2E=1 npm run test:integration
```

```bash
git add -A
git commit -m "docs: say what Forge does not do, as scope rather than backlog

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 19: Delete `docs/superpowers/`

**Files:**
- Delete: `docs/superpowers/` — six plans, five decision logs, four specs, the roadmap,
  `MINORS.md`, **and this plan**

**This task is last.** Every task brief before it is extracted from this plan file, so the
plan must survive until here. Git history keeps all of it: `git log --follow` and
`git show <commit>:docs/superpowers/<path>` retrieve any of it.

- [ ] **Step 1: Confirm nothing points into it**

```bash
grep -rn "docs/superpowers\|phase-roadmap\|decision-log\|forge-template-design" \
  --include="*.ts" --include="*.vue" --include="*.mjs" --include="*.json" --include="*.md" --include="*.yml" \
  . 2>/dev/null | grep -v node_modules | grep -v "^./docs/superpowers/"
```

Expected: no output. **If anything is listed, fix it before deleting** — that is a link that
would dangle.

- [ ] **Step 2: Delete**

```bash
git rm -r docs/superpowers/
```

- [ ] **Step 3: Confirm the final state**

```bash
ls docs/ && ls docs/adrs/
```

Expected: `docs/` holds `adrs/` and nothing else; `adrs/` holds `0000` through `0005`.

- [ ] **Step 4: Run every gate, one last time**

```bash
npm test && npm run sanitize && npm run test:integration && FORGE_E2E=1 npm run test:integration
```

Then the template's own, including the one a whole phase of reviews missed:

```bash
cd template && npx nx run-many -t test lint typecheck purity layers --projects=backend,core,webapp && npx nx run core:coverage && npx nx run webapp:build-storybook
```

Expected: all PASS.

- [ ] **Step 5: Confirm Voku is untouched**

```bash
git -C ~/Progetti/Voku status --porcelain | wc -l && git -C ~/Progetti/Voku rev-parse HEAD
```

Expected: `0` and `fdfdbdeae2891954dd1cac538a082d5837f281dd`.

- [ ] **Step 6: Commit**

```bash
git commit -m "docs: dissolve the process documents into ADRs

Six plans, five decision logs, four specs and the roadmap. They were written
for agents mid-flight and every one of them describes work that is done. What
a future maintainer actually needs is in docs/adrs/, which now runs 0000
through 0005. Git keeps the rest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Ordering

Tasks 1–7 (the minors) before Task 19, because the decision logs holding their evidence live
until then. Task 1 before Tasks 2–7, which read its output. Tasks 8–12 (the carried items)
before Tasks 17–18, so the documentation describes what is true. Task 16 before Task 19 — it
is the task that makes the template self-contained. Task 19 last, always.

Tasks 2–7 are independent of each other and of 8–15. Task 6 is a single-file change and
batches with nothing.

**The spec's §6.1 — the unreproduced 401 trio — deliberately has no task.** Three phases
spent a capped investigation budget and none reproduced it. The disposition is that nothing
is changed and the record dies with Task 19. If an implementer finds themselves writing a
retry, a sleep or a weakened assertion for a flaking 401, that is out of scope and the
finding belongs in the branch's report instead.
