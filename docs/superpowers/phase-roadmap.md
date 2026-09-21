# Forge — Phase Roadmap

Phases 1, 2 and 3 are built. This records how the remaining work is decomposed and, more
importantly, **the ordering decisions that exist to avoid rework**. They are easy to get wrong
and expensive to undo.

The spec (`docs/superpowers/specs/2026-09-17-forge-template-design.md` §9) describes the whole
identity platform as one thing. It is not one plan. It is four.

| Phase | Ships | Status |
|---|---|---|
| **1. Generator + template skeleton** | `npm run create` produces a bootable, agent-ready NX monorepo. No auth. | **BUILT** |
| **2. Identity foundation** | Users, auth identities (password provider), sessions with rotating refresh tokens, email verification, password reset, the append-only audit log — and the whole client half: services over the wire, the auth store, route middleware, and the pages a person actually uses. | **BUILT** |
| **3. Organizations + authorization** | Orgs, memberships, invitations, `can()` as pure core logic, roles, per-resource grants, guards — and the whole client half: services, `useCan`, the permission middleware, the pages. | **BUILT** |
| **4. OAuth + account linking** | Google/GitHub/OIDC adapters behind one port. | specified, not written |
| **5. MFA** | TOTP + WebAuthn, two-phase login, recovery codes. | specified, not written |

## The ordering decisions

**1. Phase 2 must build `AuthIdentity` split from `User` immediately** — even though password is the
only provider it ships. A `User` is a person; an `AuthIdentity` is one way to prove you are them.
Get this right in Phase 2 and Phase 4 *adds a provider row*. Get it wrong — auth fields hung off
`User` — and Phase 4 is a migration of every account in every generated project. (Spec ADR-0005.)

**2. Phase 2 must model login as a discriminated `AuthenticationOutcome`**, not a boolean or a
token. Phase 5 then adds an `MFA_REQUIRED` branch. If Phase 2 returns tokens directly, Phase 5
reshapes the entire login flow and every caller.

**Audit lands in Phase 2, not last**, with a nullable `organizationId`. Every later phase then
records its own events as it builds them. Bolting a cross-cutting audit log on at the end means
revisiting every handler.

**3. Phase 2's own discoveries, which Phase 3 had to not get wrong.** Each cost a fix round
to find; see `phase-2-decision-log.md` for the evidence. **All eight were discharged** —
`phase-3-decision-log.md` records how, and two of them (the SSR credential, and splitting new
conformance assertions by who can honestly satisfy them) turned out to be the load-bearing
ones.

- **Never add a foreign key to `audit_entries`.** Phase 3 gives audit entries an
  `organizationId` that finally carries a value, and the natural next move is a foreign key
  to `organizations`. A referential action runs with the *table owner's* privileges, so any
  foreign key hands the application a route into a table it has no `UPDATE` or `DELETE` on.
  [ADR-0009](../../template/docs/adrs/0009-two-database-roles.md) lists this and three more
  ways to void the guarantee, all of which leave a schema that looks correct.
- **Extend `can()`, do not restructure it.** It evaluates layer one (platform role) and the
  ownership half of layer three. Layer two is absent rather than stubbed, deliberately: an
  empty layer is a branch no test can fail and a shape the next phase is obliged to keep
  whether or not it fits. Phase 3 adds organization role as the second check and grants as
  the rest of the third, in that order, and every new `Permission` member is a compile error
  at every exhaustive switch — which is the forcing function, not an inconvenience.
- **Split any new conformance assertion by who can honestly satisfy it (DEC-1).** An
  assertion only a server can meet belongs in the backend-only security suite. Phase 2 put a
  client-context assertion in the shared suite and the webapp could satisfy it only by
  having its stub lie; moving it was motivated by honesty and also strengthened coverage.
  Tenant isolation (D9) is a server property and belongs there from the start.
- **Anywhere a driver's expectation and the implementation's answer share a source, the
  assertion is a tautology.** This cost twenty green tests sitting on top of the fault their
  own comment claimed to catch, in the backend — and the identical defect, at the identical
  magnitude, would have shipped in the webapp if the warning had not been carried forward.
- **Any wiring Phase 3 adds owes an assertion that fails when it is deleted**, plus the
  evidence of having watched it fail. Fifteen of sixteen deletions of shipped wiring once
  left the whole backend suite green.
- **DONE (Phase 3, Task 1).** *Widen the sanitize gate's `invitations?` rule before Phase 3
  starts, not during.* Spec
  §9.4 makes organization invitations a first-class concept and the gate bans the bare noun.
  The right shape is the one `event`, `payment` and `ticket` already have: ban the source
  project's compounds, not the word. Change the gate in its own commit, never inside a
  feature task.
- **DONE (Phase 3).** *ADR-0006's actual rule was cited by no review dimension in any
  package.* It now has one in each: **backend B11** and **webapp W9**, both blocking, both
  "read and judge" with a grep to surface candidates — a role comparison that decides what an
  actor may *do*, rather than what label to render, is a second statement of the rule.
- **DONE (Phase 3, Task 19).** *Take the access credential out of the SSR payload.* Ruled on 2026-09-20 after Mattia read
  the trade: Phase 2 ships with the exposure documented, Phase 3 removes it, because Phase 3
  reopens the renewal path for tenancy anyway and the change lands beside work rather than on
  top of working code. Four things are owed, and none of them needs re-deriving —
  `phase-2-decision-log.md` §6 has the mechanism and the cost. In short: seed `status` and the
  user but not the credential; add `app/plugins/auth-init.client.ts`; handle the
  `presented() === null` 401 that `createAuthFetch` today rethrows *without* renewing, on
  purpose, because that is what stops a mistyped password signing the visitor out; and get the
  second renewal race right, or reuse detection revokes the family. The no-flash behaviour is
  not at risk — the three-state `status` is what prevents the flash, not the token.

## Phase 2's final review: all eight findings closed in Phase 3

Phase 2's final review returned **MERGE, no blockers**, and six findings plus two carried
smaller ones. Every one is now closed; each is recorded here with the task that closed it so
nobody re-opens the investigation.

| Finding | Closed by |
|---|---|
| `AuthenticationOutcome`'s forcing function did not reach the webapp — its three consumers used `if` | Task 2. The injection that *demonstrates* it also had to be corrected: a bare enum member adds no variant to a discriminated union, so the valid form adds a member **and** a matching variant |
| A third masked assertion — `organizationId`, `clientAddress`, `clientLabel` all `null === null` in the audit wire-shape comparison | Task 8, and measured both ways: **499/499 green** before, **2 of 502 red** after |
| `libs/core`'s 100% coverage thresholds ran in no CI at all | Task 2. A `coverage` target already existed; the gap was that nothing invoked it |
| The layer checker had no test injecting a layering violation | Task 2, fix round 1 — `check-atomic-layers.spec.ts`, three cases driving the **shipped** script via `execFile` against `mkdtemp` fixtures |
| ADR-0008 contradicted the code on where a port lives | Task 22b. **The ADR was corrected, not the code** — see `phase-3-decision-log.md` §5 |
| `libs/core/README.md` claimed one contract per domain and one suite per contract | Task 22b. It now names the three departures that actually ship, and its `shared/` inventory includes `shared/policies` |
| A direct push to `main` ran only the `unit` tier | Task 20 — `generated-project` and `docker` now run on push, and **that is what caught a generated application that did not boot** |
| The gate list existed twice with nothing pinning the copies together | Task 20. The new pinning test **failed on its first run, on real drift**: `coverage` was in `ci.yml` and in neither of the other two lists |

Still open from that review, unchanged and not worked on this phase: two tautological
assertions (`auth.controller.spec.ts:419`, whose own comment argues against it, and
`composition-root.spec.ts:289`); `users.controller.spec.ts:197`, which sweeps for a secret in
a world that has none; nine stale doc claims across D4–D13; and spec §12 step 5's one
un-triaged residue, `https://placehold.co` in `AppImage.stories.ts:4`.

## What Phase 4 must not get wrong

Phase 3's own discoveries. Each cost at least a fix round; the evidence is in
`phase-3-decision-log.md`, and **its opening five are the ones to read before touching
authorization or the migration guards.**

- **~~Give Storybook a gate before adding another story to it — nothing has ever compiled the
  ones that exist.~~ Done, Phase 4 Task 1 (2026-09-21).** The failure was a Vite major-version
  split inside one build: Nuxt 4.5 contributes a Rolldown-native plugin that Storybook's
  Rollup-based Vite 7 build cannot call, and it threw on the entry HTML before any module was
  transformed — which is why the error named `vite:build-html` and nothing that was actually
  involved. Two further faults sat behind it. The job now runs on push and PR and blocks; the
  write-up is beside it in `.github/workflows/ci.yml`. **What carries forward: `storybook
  build` exits 0 over an empty module graph, so this gate is worth exactly what its `stories`
  glob is worth.** `apps/webapp/app/test/storybook-config.spec.ts` guards that in the fast
  tier. A green tick is not on its own evidence that any story was compiled — check the
  module count.
- **A green fast tier says nothing about whether the application boots.** Phase 3's own
  instance: a guard is instantiated in the module context of the controller that names it, so
  a module hosting a guarded controller must register every repository that guard injects.
  Missing that registration is not a type error and not a lint error — it is an
  `UnknownDependenciesException` at start-up, and it survived every fast tier for an entire
  phase. `apps/backend/src/__tests__/guard-wiring.spec.ts` catches the class in 1.3 s, and it
  **discovers** guards from `@UseGuards` metadata rather than reading a list. **Phase 4 adds
  OAuth guards and strategies; add them to controllers, then let discovery find them — do not
  convert that spec back into a list.**
- **Prose is not covered by any gate, and this phase produced five false comments.** Four were
  believed by a later reader before somebody checked. When a comment is found to be false, the
  better fix is usually to make it **true** — add the assertion it claims exists — rather than
  to soften the sentence: an incorrect pointer to coverage stops the next person looking.
- **Do not enumerate the bad inputs. Refuse what you do not model.** Five fix rounds of
  per-spelling patching in `migration-sql.spec.ts` each closed one variant and each was
  followed by another. What held is a fail-closed whitelist plus an allow-list of one
  permitted method. The general rule, from the round that stated it: *"enumerating the
  dangerous members is the move that failed five times."*
- **A guard's failure message is part of its design.** Phase 3 shipped, briefly, a guard whose
  error pointed an author at the one-character change that would reopen the hole it existed to
  close. If a refusal has an obvious remedy that is catastrophic, the message must give the
  author a way to get unstuck without reaching for it.
- **Check whether a fault is fail-closed before writing a test against it.** D9's natural
  fault — resolving the actor from the route parameter — refuses everything rather than
  leaking, and the test only discriminated because of a contrived id-collision fixture. The
  fault that can actually leak is *guard passes for the named tenant, service resolves the
  target row by id alone*. Show a fault is fail-closed by measuring it: **14 red, every one a
  control, zero refusal assertions.**
- **`can()`'s layer three fires on no route, and D12 is a labelled partial with a tripwire.**
  Grants are hydrated, expiry-filtered, served on `GET /users/me/principal` and consumed by
  nothing, because naming the organization itself as the record would make an admin's
  `grant:create` a route to `organization:delete`. **The first `can()` call site that passes a
  `resourceType`/`resourceId` trips the tripwire and owes D12 a real test** — and it also makes
  the currently-inert case-sensitivity of the `platform:administer` refusal real.
- **Nothing in the webapp enumerates `Permission`, and that is load-bearing.** `useCan` and the
  permission middleware forward it to `can()` as an opaque value, so the forcing function is
  core's and reaches the webapp by construction (the webapp cannot compile against a core that
  does not build). **A hardcoded list of permissions in a page, a menu or route meta silently
  breaks this** — the check is a grep, and it is manual.
- **Split any new conformance assertion by who can honestly satisfy it (DEC-1).** Phase 3
  produced its evidence, and the injection that produces it is not the obvious one: the planned
  injection reached the same line from both suites and could not have demonstrated a split.
  Also measured, and the reason the comparisons assert **bodies**: a `404` carrying a different
  `code` for a cross-tenant record reds the body comparison while all five status-comparing
  rows stay green.
- **`FakeDataSource` enforces no unique constraints and has no foreign keys.** Every uniqueness
  invariant and every `ON DELETE SET NULL` path is invisible to the fast tier. A defect that
  needs a real constraint to appear will appear in the real-database tier or nowhere.
- **Never add a foreign key to `audit_entries`** — carried unchanged from Phase 2, and Phase 3
  demonstrated a second way to void the guarantee that no foreign key rule catches:
  `ALTER TABLE audit_entries OWNER TO <app role>`, since the owner is not subject to the
  `REVOKE` and can re-grant itself.

## Two things Phase 3 knowingly did not close

**1. This development machine still cannot run the declared Node locally — the template
itself is not unverified on it.** `template/package.json` says `>=22 <23`, both Dockerfiles
pin 22, and all four non-schedule CI jobs — including `generated-project` and `docker`, which
run on every push, not only on a PR — pin `node-version: 22`. **Node 22 is exercised on every
push to `main`.** What Phase 2 recorded, and what Phase 3 found the mechanism behind, is
narrower than that: this machine has no real Node 22 at all — **every `node@20`…`node@26`
opt-symlink aliases the same Node 26.5.0 keg** — so installing it by the obvious route does not
give you it, and any `nx`/`npm` command run by hand here runs on 26. That is a gap in what
*this machine's own ad hoc runs* verify, not in what the project's own gates verify; the
gate's mismatch warning fired correctly every time a by-hand run diverged, which is the guard
working, on the narrower gap it actually covers.

**2. Storybook's build failure is root-caused and the job now blocks, as of Phase 4 Task 1
(2026-09-21).** It was `✓ 0 modules transformed`, then `[vite:build-html] Missing field
'moduleType'` — and neither half of that named anything that was wrong. Nuxt 4.5's
`@nuxt/vite-builder` contributes a `nuxt:replace` plugin that is Rolldown-native (Nuxt 4.5
builds on Vite 8), while `@storybook/builder-vite@9` builds with Vite 7 / Rollup, which calls
it with an argument shape the native binding rejects. It threw on `iframe.html`, the first
module in the graph, so nothing downstream ever ran and the plugin named in the error was
merely the one holding that file's transform chain. Behind it sat two more faults, invisible
until the build got far enough to reach them: `.storybook/preview.ts` imported a stylesheet
this template has never had, and the stories' `libs/core` imports could not be bundled out of
core's CommonJS `dist/`. The job is now `github.event_name != 'schedule'` with no
`continue-on-error`, and the four Phase 3 stories have been compiled for the first time.

**The part worth remembering is not the fix.** For the whole time this job was red it was
*also* verifying nothing, and those are two independent facts — had the `moduleType` error not
happened to be fatal, the identical job would have gone green having transformed zero modules,
and the yellow mark that made someone look would never have appeared. A failed run even leaves
a `storybook-static/` directory behind. The exit code was never the evidence here; the module
count is. `apps/webapp/app/test/storybook-config.spec.ts` asserts in the fast tier that the
`stories` glob still matches real files, because that assumption is the one this job cannot
check about itself.

## Triage: thirteen minors deferred from Phase 3

Ledgered rather than looped, per the standing rule. The full evidence for each is in
`phase-3-decision-log.md` §8; this is the actionable list, ordered by what the final review
should weigh first.

| | Item | Cost to close |
|---|---|---|
| 1 | **`auth-init.client.ts` awaits `store.renew()`**, and Nuxt holds the mount for an async plugin — so every full page load for a signed-in visitor inserts a backend round trip before hydration completes, and a hung renewal blocks interactivity indefinitely (`createApiClient` has no timeout). `status` is already seeded, so not awaiting may be strictly better. **Every generated project inherits this.** | One decision plus a test; possibly one line |
| 2 | **The webapp/backend error-code lists disagree on sort order.** The backend uses `.localeCompare()`, the webapp's check used bare `sort()` (code-unit order); they differ on exactly one pair, `INVITATION_NOT_FOUND` vs `INVITATION_NO_LONGER_OPEN`. **The verification passed because it used the wrong comparator**, defeating the "compare them by eye" property that is the whole defence of the snapshot route | One line |
| 3 | **`tools/sanitize.mjs` misses no-separator compounds** — `OrganizationInvitation` slips every rule, because the bare-word term rule has no camelCase/PascalCase boundary handling the way the `event`/`payment`/`ticket` rules do. Live now: the template ships `mail/templates/organization-invitation.ts` | One rule, in its own commit — never inside a feature task |
| 4 | **`dependsOn` is inert-if-renamed, silently.** Nuxt filters on `p._name`; if `@pinia/nuxt` renames its plugin the belt becomes a no-op with no warning. Harmless today only because the `if`-guard is what actually holds | One sentence in the comment |
| 5 | **`migration-sql.spec.ts` holds two matching styles** — the normalizer for security guards, raw source text for schema-shape assertions. Defensible, but it should be a **stated** split rather than an accident | A paragraph in the file's TSDoc |
| 6 | **The `platform:administer` refusal is a case-sensitive literal comparison.** Inert while layer three is consumed by nothing; becomes real the moment a consumer wires it | Pair with D12's tripwire |
| 7 | **`audit.service.ts` still hand-builds a `Principal` literal** rather than using `PrincipalService` — a second place the principal's shape is stated | Small refactor |
| 8 | **`createOrganization`'s audit test compares against the service's own return value**, unlike its update/delete siblings | Read the value back from the store |
| 9 | **`useInvitations.load` hardcodes the `PENDING` filter**, foreclosing an invitations-history view without a fetcher bypass | A parameter defaulting to `PENDING` |
| 10 | **`api-error-code.spec.ts`'s comment still claims "the same eleven names"**; there are 14 | One line |
| 11 | **No `LoginForm.spec.ts` case for the exhaustive switch** (the typecheck is self-protecting) | ~4 lines |
| 12–13 | **Two near-tautological `fromJSON` round-trip comparisons** in `Organization.spec.ts` and `Membership.spec.ts` — `expect(revived.toJSON()).toEqual(original.toJSON())` restating the `toJSON` tests. The rule that stopped the pattern spreading landed at Task 5; these are the residue | Delete the trailing comparison |

Also recorded and deliberately not actioned: the `migration-sql` lint **exemption pin keys on
file + rule name only**, so moving an exemption *within* a file passes silently.

## What Phase 4 inherits, already built

| | Where |
|---|---|
| `can(principal, permission, resource?)` — all three layers, with `platform:administer` excluded from layer three at both ends | `libs/core/src/authorization/policies/` — **not** `shared/policies/`, which is for primitives with no domain dependency |
| `Permission` (15 members), `Principal` (with `memberships` and `grants` both **required**), `ResourceGrant`, `ROLE_PERMISSIONS`, `isGrantLive` | `libs/core/src/authorization/` |
| `Organization`, `Membership`, `Invitation`, `OrgRole`, `InvitationStatus`, and the nine domain errors | `libs/core/src/organizations/` |
| `PlatformRole` and `OrgRole`, ADR-0006's first two authorization layers | `libs/core/src/users/enums/`, `libs/core/src/organizations/enums/` |
| an `organizationId` on `AuditEntry` that **carries a value** and is pinned by the wire-shape comparison and a filter test | `libs/core/src/audit/`, `audit_entries` |
| `PermissionsGuard` + `@RequirePermission`, `PrincipalService` (the one hydrator, where expiry runs) and `GET /users/me/principal` | `apps/backend/src/authorization/`, `apps/backend/src/users/` |
| `PlatformAdminGuard` + the interceptor that records every pass **after** the handler | `apps/backend/src/auth/guards/` |
| `guard-wiring.spec.ts` — guards discovered from `@UseGuards` metadata, so a new guard is covered without anyone adding it to a list | `apps/backend/src/__tests__/` |
| the conformance split — shared suites plus **two** server-only security suites (`IAuthService`, `IOrganizationService`) — and a vitest and a jest adapter | `libs/core/src/*/testing/`, `apps/backend/src/common/testing/`, `apps/webapp/app/services/__tests__/` |
| `useCan`, the permission route middleware, and pages that declare it | `apps/webapp/app/composables/`, `apps/webapp/app/middleware/`, `apps/webapp/app/pages/` |
| the two database roles, the start-up privilege guard, and a fail-closed static guard over every migration's SQL | `apps/backend/src/db/`, `apps/backend/src/db/__tests__/migration-sql.spec.ts` |
| an SSR payload that carries **no** access credential, with the store's `status` as the discriminator | `apps/webapp/app/plugins/` |

## What "done" means for each phase

The same bar Phase 1 met: a generated project passes its own `lint`/`typecheck`/`test`/`build`/
`purity`, boots under Docker, and the new work is covered by tests that have been **observed to
fail** when their fault is injected. A green suite is not evidence.

Phase 2 added two clauses to that bar, both because a green suite was found to mean nothing:

- **The artifact that ships is the thing under test.** A spec that assembles its own module,
  or a probe that registers the provider it is checking for, is testing itself. Where the
  wiring is a value, assert that exact value; where it is imperative, extract it into a
  function the entry point and the spec both call.
- **A check that cannot fail is worse than an absent one**, because it reads as evidence.
  That applies to an assertion an entity's own invariants make unfailable, to a grep whose
  subject does not exist in the tree it scans, and to a build command that exits 0 without
  running.

Phase 3 added two more, for the same reason and one level up:

- **A gate that runs only on the path somebody can choose not to take is not a gate.** The
  generated application did not boot for part of Phase 3 while every fast tier was green,
  because the only tiers that run it were pull-request-only on a branch being pushed to.
  `generated-project` and `docker` now run on push.
- **Prose is part of the artifact and no gate reads it.** A comment that asserts something the
  code does not do reads as authoritative and is not — five of them shipped clean through every
  gate this project owns. When one is found false, prefer making it true.

The rulings behind all four, and everything else decided along the way, are in
`phase-1-decision-log.md`, `phase-2-decision-log.md` and `phase-3-decision-log.md`. Read the
second one's opening five before touching the identity foundation, and the third's before
touching authorization, tenancy or the migration guards.
