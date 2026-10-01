# Forge Phase 7 — The Closing Phase

- **Date:** 2026-10-01
- **Status:** Draft for review
- **Phase:** 7, and the last. There is no Phase 8.
- **Inherits:** `docs/superpowers/phase-roadmap.md`, `docs/superpowers/phase-5-decision-log.md` §7–§8

## 1. What this phase is for

Phases 1 through 6 built the thing. Every numbered phase is `BUILT` and spec §9 is
feature-complete. What is left is not capability — it is the residue of having built in
phases: ledgered findings nobody drained, process documents written for agents mid-flight,
orientation files describing a state four phases old, and a handful of items each prior
phase declined with a reason.

**The goal is that nothing in this repository reads as incomplete.** Not "nothing is
tracked as incomplete" — the difference matters. Every open item ends this phase in one of
exactly two states:

1. **Closed.** The work is done and the record of it being open is deleted.
2. **Decided.** The work will not be done, and what was a deferral is rewritten as a stated
   property of the software, in the place a reader meets it.

Nothing ends as "deferred", "planned", "not yet", "TODO" or "Phase 8 inherits".

This phase adds no product capability. The one thing it may add — an OpenAPI document — is
a description of what already exists, and it is conditional (§6.7).

### 1.1 The two decisions this phase was scoped around

Both were made by the project owner before the spec was written, and they bind everything
below:

- **The 27 ledgered minors get drained, not dispositioned again.** They have been triaged
  twice (Phase 5 §7 dispositioned 41 of them; 27 survived because no phase reopened their
  files). A third triage is not a close.
- **`docs/superpowers/` is deleted entirely**, with what is worth keeping extracted into
  ADRs first, at the smallest footprint that leaves the repository coherent.

## 2. Non-goals

- **Nothing from spec §9.9.** Nested teams, SAML/SCIM, API keys and machine-to-machine
  tokens, per-field permissions and self-service billing are out, as they have been since
  the spec was written. §6.8 says how their record changes.
- **`forge update` / drift detection is not built.** The receipt stays; what changes is that
  ADR-0004 explains what the receipt is for, so it stops reading as dead code.
- **No new dependency on the generator.** ADR-0002 is untouched. `tools/create/` and
  `tests/` remain Node builtins only, and the root `package.json` keeps no `dependencies`
  and no `devDependencies`.
- **No rewrite of code that works.** The 27 minors are the list. A reviewer who finds a
  twenty-eighth records it in the branch and it is drained in this phase; a reviewer who
  wants a refactor beyond them is out of scope.
- **The empty documentation directories stay.** `template/docs/{api,architecture,concepts,
  guides,rfcs}/` each hold a README naming what belongs there, and ADR-0001, ADR-0003 and
  ADR-0004 of the *template's* set refer to them. They are documented scaffolding for a
  generated project's team to fill, not a gap in Forge.

## 3. Global constraints

Every task inherits these. They are copied verbatim into each task brief.

- **`~/Progetti/Voku` is read-only.** Never write to it; never run a command there that
  could change tracked or untracked state. Before and after any task, confirm
  `git -C ~/Progetti/Voku status --porcelain` is empty and
  `git -C ~/Progetti/Voku rev-parse HEAD` is unchanged. **Those two read-only commands are
  required, not forbidden.**
- **The generator takes no dependencies.** See §2.
- **`npm run sanitize` must pass before any commit touching `template/`.** Never weaken a
  rule to make a commit pass. `tools/sanitize.mjs` is modified by exactly two tasks in
  this phase — one for its four carried rule items (§4.2, P4#19–#22) and one for the stale
  citation in §5.4 — and by nothing else. Both must leave the gate passing on the whole tree.
- **The sanitize gate rejects Forge's process vocabulary inside `template/`.** Re-pointing
  the citations in §5.3 must not introduce "Phase 5", "Phase 6" or any phase coordinate into
  template prose.
- **Never add a foreign key to `audit_entries`**, in either direction. A referential action
  runs with the table owner's privileges and voids ADR-0009.
- **`libs/core` stays framework-agnostic and transport-free, in prose as well as imports.**
  `grep -riE "\bjwt\b|cookie|http" template/libs/core/src` returns nothing.
- **ADR-0013 governs every mechanism choice.** Use the framework's own component; adapt it
  at its published extension point; record any departure beside the code with what the
  framework's answer is and what it fails to do here.
- **State the invariant, not the enumeration.** A comment or document that counts is true
  when written and rots silently. This phase exists partly to clean up four instances of
  exactly that defect, so it must not add a fifth.
- **Verify module format before adopting any package.** `@nestjs/terminus` 12.x,
  `@nestjs/jwt` 12.x and `@nestjs/passport` 12.x are `"type": "module"`; the backend
  compiles to CommonJS and its Jest runner is CJS, so importing one fails before any test
  runs. Peer ranges and API shape are not evidence about module format. §6.7 is the only
  task that may add a package, and it must probe first.
- **`FORGE_E2E=1 npm test` runs the unit tier and nothing else.** The slow tiers are
  `npm run test:integration`.
- **`coverage` is a separate nx target and `libs/core` enforces 100%.** `-t test lint
  typecheck` passes while coverage fails. Any task touching `libs/core` runs coverage.
- **Docker headroom** is measured with `docker run --rm alpine df -h /`, never
  `docker system df`. Never stop, remove or reconfigure a container this work did not create.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 4. Workstream A — drain the 27 minors

The list is fixed. It is the 27 that survived Phase 5's triage, taken from
`phase-roadmap.md` §Triage and `phase-5-decision-log.md` §7. Evidence for each is in the
decision logs, which this phase deletes — so **every item below carries enough description
to be actioned without them**, and the plan's task briefs must quote it rather than cite.

### 4.1 Carried from Phase 3 — nine

| # | File | What | Close by |
|---|---|---|---|
| P3#1 | `template/apps/webapp/app/plugins/auth-init.client.ts` | The plugin `await`s `store.renew()`, and Nuxt holds the mount for an async plugin — so every full page load by a signed-in visitor inserts a backend round trip before hydration completes, and a hung renewal blocks interactivity indefinitely (`createApiClient` has no timeout). `status` is already seeded from the server payload, so not awaiting may be strictly better. Every generated project inherits this. | A decision plus a test that discriminates it. If the renewal stops being awaited, a test must show hydration completing while the renewal is in flight |
| P3#4 | same file | `dependsOn` filters on `p._name`; if `@pinia/nuxt` renames its plugin the dependency becomes a silent no-op. It is harmless today only because the `if`-guard is what actually holds the invariant | One sentence in the comment stating that the guard, not `dependsOn`, is load-bearing |
| P3#5 | `template/apps/backend/src/db/__tests__/migration-sql.spec.ts` | The file holds two matching styles — a normalizer for security guards, raw source text for schema-shape assertions. Defensible, but currently an accident rather than a stated split | A paragraph in the file's TSDoc saying which assertions use which style and why |
| P3#6 | `template/apps/backend/src/auth/guards/platform-admin.guard.ts`, `authorization.service.ts`, `template/libs/core/src/authorization/policies/can.ts` | The `platform:administer` refusal is a case-sensitive literal comparison. Inert while layer three is consumed by nothing; real the moment a consumer wires it | `d12-grant-revocation.spec.ts` already holds a tripwire asserting that no `can()` call in the backend names a record. Tie this fix to it, so the case-sensitivity and the missing D12 surface together on the day layer three gains a consumer |
| P3#7 | `template/apps/backend/src/audit/audit.service.ts` | Hand-builds a `Principal` literal rather than using `PrincipalService`, making a second place the principal's shape is stated | Use `PrincipalService`, or state why this caller cannot |
| P3#8 | `template/apps/backend/src/organizations/__tests__/organizations.service.spec.ts` | `createOrganization`'s audit test compares against the service's own return value, unlike its update and delete siblings, so it cannot catch a service that returns what it failed to store | Read the value back from the store, as the siblings do |
| P3#9 | `template/apps/webapp/app/composables/useInvitations.ts` | `load` hardcodes the `PENDING` filter, foreclosing an invitations-history view without bypassing the fetcher | A parameter defaulting to `PENDING` |
| P3#12 | `template/libs/core/tests/organizations/entities/Organization.spec.ts` | A near-tautological round trip: `expect(revived.toJSON()).toEqual(original.toJSON())` restates what the `toJSON` tests already assert | Delete the trailing comparison |
| P3#13 | `template/libs/core/tests/organizations/entities/Membership.spec.ts` | Same shape as P3#12 | Same |

### 4.2 Carried from Phase 4 — eighteen

| # | File | What | Close by |
|---|---|---|---|
| P4#3 | `template/apps/backend/src/auth/oauth/__tests__/oauth.config.spec.ts` | `expectOnlyRealAdapters` does not cross-check that the provider occupying the GITHUB slot is specifically `GitHubOAuthProvider`, so a mis-wired registry passes | Assert the concrete class per slot |
| P4#4 | `template/apps/webapp/app/test/storybook-config.spec.ts` | Counts `.stories.ts` only, while the Storybook glob matches `@(js\|jsx\|mjs\|ts\|tsx)`. This is the fast-tier guard on the one assumption the Storybook job cannot check about itself, and it undercounts the moment a `.tsx` story lands | Count every extension the glob matches |
| P4#7 | `template/apps/backend/src/auth/oauth/adapters/OidcOAuthProvider.ts` | `DISCOVERY_PATH` is concatenated onto `OAUTH_OIDC_ISSUER_URL` with no trailing-slash normalisation, so a configured issuer ending in `/` yields a double slash | Normalise, with a test for both spellings |
| P4#8 | `template/apps/backend/src/auth/oauth/adapters/__tests__/DevOAuthProvider.spec.ts` | The "makes no network call" assertion is a literal-text check for `fetch(` in the source | Assert the behaviour — stub the global and assert it is never called |
| P4#9 | `template/apps/backend/src/auth/oauth/adapters/DevOAuthProvider.ts` | The `consumed` map is unbounded. Development-only, ~43 bytes per sign-in, every entry dead after the TTL | Evict on read, or state the bound and why it is acceptable |
| P4#13 | `template/apps/backend/src/auth/oauth/entities/oauth-authorization-request.entity.ts` | `purpose!: string` is untyped, and the deliberateness is stated on the migration's column rather than on the field a reader meets first | Type it, or state it where it is read |
| P4#14 | `template/apps/backend/src/db/migrations/1758000004000-OAuthAuthorizationRequests.ts` | Only 4 of 10 columns get `COMMENT ON`, and the selection is not stated as deliberate | State the rule that selects them |
| P4#15 | `template/apps/backend/src/auth/oauth/adapters/{GitHub,Google,Dev}OAuthProvider.ts` | `authorizationUrl` builds its query by string concatenation — correct only while the redirect URI stays query-less | Use `URLSearchParams`, or state the precondition at each site |
| P4#16 | `template/apps/backend/src/auth/oauth/__tests__/oauth.config.spec.ts` | The `PUBLIC_API_URL`-omission regression test is nested inside a `describe` about the PF-1 collision, which it does not test | Move it to its own `describe` |
| P4#19 | `tools/sanitize.mjs` | Digit-adjacent widening (`organizer1`, `x1organizer`) is unstated and untested | A test per spelling, and a sentence in the rule's comment |
| P4#20 | `tools/sanitize.mjs` | Consecutive-capital acronym compounds (`APIOrganizerService`) are not caught by the widened rule | Widen, with tests |
| P4#21 | `tools/sanitize.mjs` | The path-only `event\|payment\|ticket` rule was not widened. Needs basename extraction plus a judgment about strictness | Its own task. Widen with basename extraction, or state why path-only is correct |
| P4#22 | `tools/sanitize.mjs` | The gate excludes itself from its own scan, so its own process-vocabulary strings go uncaught | Scan itself, with whatever narrow allowance its rule definitions genuinely need, stated |
| P4#23 | `tests/unit/sanitize.test.mjs` | Two "the brief" instances live in `tests/`, which is outside the gate's scope by design | Either bring `tests/` into scope or state the exclusion in the gate's own TSDoc |
| P4#24 | `nx.json` | `build-storybook` declares no `outputs` in `targetDefaults`, so nx cannot cache it | Declare the output directory |
| P4#26 | `template/apps/webapp/app/services/oauth.service.ts` | Has no `domainErrorFor`, which is correct but unexplained in a directory where every sibling has one | One TSDoc line saying why this service has none |
| P4#27 | `template/apps/webapp/app/pages/account/identities.vue` | `onMounted` fires `load()` and `loadProviders()` in parallel with `void`, so neither rejection is handled | Await both, or handle rejection |
| P4#29 | `template/libs/core/src/identities/types/FederatedSignInInput.ts` | TSDoc references `{@link User}` without importing it, against established house style | Import it or drop the link |

### 4.3 Then delete the ledger

Both triage tables go. Because §5 deletes `docs/superpowers/` wholesale, this happens by
deletion rather than by edit — but it is listed here so the completion criterion is
explicit: **after this phase, no document in the repository lists an open finding.**

### 4.4 Rules for draining

- **Each item closes with evidence.** Where an item names a test, the test must be watched
  red before it is watched green, or its diagnosis must be shown by mutation.
- **P3#12, P3#13 and P4#29 are deletions or one-liners.** They are batched into one dispatch,
  not given a task each.
- **P3#1 is the only item here carrying a design decision.** It is a task of its own.
- **The four `tools/sanitize.mjs` items (P4#19–#22) are one task**, because they edit one
  file's rules and must leave the gate passing together.

## 5. Workstream B — dissolve `docs/superpowers/`

### 5.1 Two new ADRs, written before the deletion

**`docs/adrs/0004-the-generator-contract.md`.** What the generator promises and why.
Content, drawn from spec §6, §7 and §10 while they still exist:

- The token set, and why it is exactly those tokens — a token exists where a generated
  project must differ, and nowhere else.
- Substitution as the only transform. This is ADR-0002's consequence made concrete: with no
  dependencies there is no YAML or JSON merging, so the generator copies and substitutes,
  and nothing else.
- Adopt mode as subset selection over the same tree, and never-overwrite as its safety
  property.
- **`forge.json` as a receipt.** It records the commit a project was generated from. Nothing
  reads it today. It exists because drift detection is the one tool that would need it and
  could not be added retroactively — a project generated without a receipt can never be
  diffed against its origin. Writing this down is what stops the receipt reading as dead
  code.

**`docs/adrs/0005-four-test-tiers.md`.** Why the gates are tiered, from spec §11:

- What each tier proves that the tier below it cannot: unit (substitution logic), generated
  project (the output builds and passes its own gates), storybook (the component library
  compiles), docker (the stack boots against real Postgres).
- **D1–D16 as a named set**, and what makes a discriminating test different from a unit
  test: it is written to fail against a plausible wrong implementation, not merely to pass
  against the right one. The tests themselves live in
  `template/apps/backend/src/__tests__/discriminating/` and stay there; the ADR says why the
  category exists.

Both follow `docs/adrs/0000-template.md`. Neither restates anything that is already code.

### 5.2 Rewrite the orientation files

- **`CLAUDE.md`** — its "authoritative documents" block names a spec and a Phase 1 plan that
  will not exist, and asserts that "later phases (identity foundation, tenancy,
  authorization, audit) are planned but not yet built", which has been false since Phase 3.
  Rewrite it around the five ADRs. The three rules an agent must not break are unchanged.
  The "Where things live" table loses its `docs/superpowers/` row.
- **`README.md`** — the "More" table loses its design-spec and phase-roadmap rows and gains
  the two new ADRs. Nothing else in the README changes; it was rewritten two commits ago.
- **`template/libs/core/README.md`** — it enumerates core's domains and names six. There are
  eight; `mfa/` and `auth/` postdate it. Rewrite the passage to **state what makes something
  a domain** and let the tree be the list. This is the same defect the global constraints
  forbid, shipping to every generated project.

### 5.3 Re-point the 50 citations inside `template/`

Fifty comments and TSDoc blocks under `template/` cite "spec §N". They are copied into every
generated project, which never receives Forge's spec — so each one already points at
nothing, independently of this phase.

For each: **if a template ADR covers the claim, cite that ADR. Otherwise, state the rule
instead of citing anything.** The mapping is not mechanical and the implementer verifies each
one against the ADR's actual text rather than trusting this table:

| Cited | Usually belongs to |
|---|---|
| §9.4 (organizations, roles, invitations) | ADR-0007 (tenancy is explicit), ADR-0010 (invitations) |
| §9.5 (`can()` and its three layers) | ADR-0006 (authorization is a pure function in core) |
| §9.1–§9.3 (identity, providers, linking) | ADR-0005 (identity is separate from user), ADR-0008 (ports not vendors), ADR-0011 (federated identity never auto-links) |
| Phase 5 spec §3.1, §4.2, §11.2 (MFA) | ADR-0012 (a second factor is a property of the account) |
| §11 (D-numbers) | the discriminating test file itself, by name |

A citation with no ADR home is rewritten to say the thing. `grep -rn "spec §\|Spec §"
template/` returns nothing when this is done, and that grep is the completion check.

### 5.4 Fix the two already-dangling references

- `tools/refresh-lockfile.mjs:10` cites `docs/superpowers/lockfile-report.md`. **That file
  does not exist** and is not in git history under that path. Remove the citation or
  replace it with the explanation it was pointing at.
- `tools/sanitize.mjs:506` cites `.superpowers/sdd/2026-09-18-forge-phase-2-identity-
  foundation/task-17-report.md` §10.1 — a git-ignored execution workspace deleted at the end
  of Phase 2. Replace the citation with the reasoning itself.

### 5.5 Delete the directory

`git rm -r docs/superpowers/` — six plans, five decision logs, three specs and the roadmap,
**including this spec and this phase's own plan.** Git history keeps all of it; `git log
--follow` and `git show <commit>:docs/superpowers/...` retrieve any of it.

**This is the last task in the phase**, because the plan file must exist for every task
brief extracted before it.

## 6. Workstream C — settle the seven carried items

### 6.1 The unreproduced 401 trio — nothing to do

Three backend specs have been reported flaking as spurious 401s. Phases 3, 4 and 5 each
spent a capped investigation budget; none reproduced it. Phase 5 §1 is the fullest write-up
and it concludes with the flake unlocated.

**Disposition: the record dies with §5.5 and nothing is changed.** No test is weakened, no
retry is added, no code is touched. If it recurs it is a fresh bug investigated fresh, which
is the honest state after three failures to reproduce. **Cost if wrong:** a fourth
investigation starts from zero instead of from three logs — which is close to where the
third one started.

### 6.2 The development Storybook crash

`storybook build` passes and is gated in CI; `storybook dev` is reported to crash.

Reproduce it first. Then:

- If the fix is bounded — a version alignment, a Vite config entry — **make it**, with the
  Storybook tier still green.
- If it is not bounded, **state it** in the root README's existing "Known limitations"
  section: what crashes, that the build is the gate, and what a developer does instead. A
  stated limitation is a closed item. A silent one is not.

Do not delete the `storybook` script to make the problem disappear.

### 6.3 The real-Postgres confirm walk

`tests/integration/docker.test.mjs` covers much of the MFA surface against real Postgres but
not the confirm leg — that is covered by the fake only. Add a walk that enrols a TOTP method
and confirms it against the container, asserting the method is confirmed and that a recovery
batch exists afterwards (the confirmation and the batch are one transaction, so the second
assertion is what discriminates a broken boundary).

Measure Docker headroom with `docker run --rm alpine df -h /` before building.

### 6.4 The concurrent double-enroll `409`

Two simultaneous enrolments of one WebAuthn credential answer `500` instead of `409`. The
duplicate check runs outside the transaction, so the unique index refuses the second write
after the check has passed. **Correctness already holds** — the index does refuse it; only
the error shape is wrong.

Phase 6 declined this because the obvious fix moves a transaction boundary. It does not have
to: **catch the Postgres unique-violation (`23505`) on that index and map it to the existing
domain error.** That is the database's own answer surfaced through the framework's error
path, which satisfies ADR-0013 without restructuring anything. Discriminate it with a test
that simulates the violation rather than racing two real requests.

### 6.5 The recovery-code transition

Already decided and the decision is right: nothing is deployed, no generated project holds
stored codes, and accepting both encodings would be permanent surface. The only thing
carrying it forward was the roadmap sentence saying to revisit it first, and the backend
CHANGELOG's breaking note — **and §7.2 deletes that changelog**, because every generated
project is fresh and the note explicitly excludes fresh projects.

Nothing to implement. The item closes when both records are gone.

### 6.6 Copy for a throttled refusal

**Check the premise before writing anything.** The roadmap recorded this as "a throttled
person sees the generic failure message", but the backend side already exists: the exception
filter maps `TooManyAttemptsError` to `429` with `messageKey:
'errors.common.too_many_attempts'` — "Too many attempts. Wait a moment and try again" — and
D16 asserts the code, a translated message *and* a retry window on the response. The webapp's
`ApiError` carries `body.message`. `TooManyAttemptsError` carries `retryAfterSeconds`.

So the gap is narrower than it was written, and it may be narrower still. Establish what a
throttled person actually sees on each path that can throttle before deciding what to write.
The likely answer is that the backend's message arrives but the **retry window does not reach
the person**, which is the part that turns a dead end into a wait.

Then, whichever it is:

- **If the person already sees the backend's message and the window**, the item is closed by
  verification. Write the test that shows it, and nothing else.
- **If the message arrives but the window does not**, surface the window. That is the whole
  change.
- **If the path shows its own generic copy instead**, map the code, following whatever
  mechanism that path already uses — the shape of `FEDERATED_REFUSAL_CODES`' message map if it
  has none of its own.

One locale key and one mapping entry is the expected size. **If it grows past that, stop and
state the limitation instead**, because a new mechanism for one string is not a close; it is a
new thing to maintain.

### 6.7 OpenAPI — conditional on a probe

The webapp's service layer is written by hand against a contract that exists only as backend
source. An OpenAPI document is where the first drift would otherwise appear, and
`@nestjs/swagger` is the framework's own answer, so ADR-0013 points at it.

**Probe before committing to it.** Install `@nestjs/swagger` at the version that pairs with
Nest 11 into a scratch copy and read its `package.json` for `"type"`. The global constraint
on module format is not optional here: this is the exact mistake Phase 6 made with
`@nestjs/terminus`.

- **If it is CommonJS:** wire `SwaggerModule` and `DocumentBuilder`, and enable the
  **`@nestjs/swagger` CLI plugin** so DTO schemas are inferred from TypeScript types — that
  is what keeps this from becoming `@ApiProperty` on forty files. Serve it outside
  production. Add it to the backend README.
- **If it is ESM-only:** do not add it, do not work around it. Record it in the root
  README's "Known limitations" — the framework's own answer is unavailable to a CommonJS
  Nest build, and the backend source stays the contract.

Either branch closes the item. The second is not a failure.

### 6.8 §9.9 and §14 stop being lists of deferred work

These sections live in the spec, which §5.5 deletes, so they vanish — but the *content*
needs a home, because "nested teams are not supported" is a fact about the software that a
reader should be able to find.

The root README already has a **"Known limitations"** section. It gains one short paragraph:
what Forge deliberately does not do — nested teams, SAML/SCIM, API keys and
machine-to-machine tokens, per-field permissions, self-service billing — **written as scope,
not as backlog.** No "yet", no "planned", no "Phase N".

`forge update` is covered by ADR-0004 (§5.1), where the receipt is explained. Publishing to
npm needs no record at all: it is an action nobody has taken, not a gap in the software.

## 7. Workstream D — the template's own unfinished signals

### 7.1 The placeholder index page

`template/apps/webapp/app/pages/index.vue` ships raw `h1`/`p`, carries a comment telling the
reader to delete it, and has a **named exemption** in `template/apps/webapp/STANDARDS.md`
from the HTML-only-in-atoms rule.

Rebuild it from the atoms that already exist — `AppContainer`, `AppSection`, `AppStack`,
`AppHeading`, `AppText`, `AppLink` — as a minimal, domain-free landing page that links to
sign-in and register. Then **delete the STANDARDS exemption**, so the rule has no exceptions
rather than one explained exception. Keep it visually plain; it is a starting point, not a
marketing page. The `home.title` / `home.subtitle` locale keys stay, with the subtitle
reworded so it no longer calls the page a placeholder.

The component's existing Storybook and Vitest conventions apply: if a page gets a test in
this codebase, this one gets one too.

### 7.2 Delete the three template changelogs

`template/apps/backend/CHANGELOG.md`, `template/apps/webapp/CHANGELOG.md` and
`template/libs/core/CHANGELOG.md` record **Forge's** build history inside files a generated
project inherits as its own. The webapp's says "No business domain, auth, fetchers,
composables, or stores yet" — Phase 1 talking, with fifteen organisms and a full auth
surface now shipping. `libs/core`'s is three lines and empty. The backend's breaking note
about recovery codes ends by excluding fresh projects, and every generated project is fresh.

Delete all three. A generated project starts a changelog on its first release, which is when
its first entry would be true. Check `template/docs/standards/git.md` and the template's
READMEs for references to these files and remove any.

### 7.3 Sweep for anything this spec missed

A final pass over the whole tree for the vocabulary of incompleteness — "not yet", "planned",
"deferred", "for now", "coming soon", "TODO", "placeholder", "Phase N" — in prose, excluding
the legitimate uses the codebase already makes of the word "stub" for test doubles and
"placeholder" for the HTML attribute and `tools/refresh-lockfile.mjs`'s substitution
identities. Anything found is closed or stated, under the §1 rule.

## 8. What "done" means

The phase is complete when all of the following hold:

1. `npm test`, `npm run sanitize`, and `npm run test:integration` pass, and the `coverage`
   target passes for `libs/core`.
2. `FORGE_E2E=1 npm run test:integration` passes, including the new confirm walk (§6.3).
3. `grep -rn "spec §\|Spec §" template/` returns nothing.
4. `docs/superpowers/` does not exist; `docs/adrs/` holds `0000` through `0005`.
5. No file in the repository names an open, deferred or planned item. The sweep in §7.3 is
   the evidence.
6. `git -C ~/Progetti/Voku status --porcelain` is empty and its HEAD is unchanged.

## 9. Risks

- **Deleting the decision logs loses evidence for the 27 items while they are being
  drained.** Mitigated by §4 carrying each item's full description, and by ordering: §5.5 is
  the last task, so the logs survive the whole of Workstream A.
- **Re-pointing 50 citations is the largest surface for introducing a false statement.** This
  phase's prior art is unambiguous: three corrections in Phase 6 introduced fresh
  inaccuracies. Every re-pointed citation must be checked against the ADR's actual text, and
  a citation the implementer cannot verify becomes a stated rule rather than a guessed link.
- **The index page rebuild could grow.** It is a plain landing page. If it starts acquiring
  layout work, it has exceeded its purpose.
- **§6.7 may add a dependency.** It is the only task permitted to, it is conditional on a
  probe, and the no-dependency rule still binds the generator absolutely.
- **This spec deletes itself.** That is intended, and it is why §5.5 is ordered last.
