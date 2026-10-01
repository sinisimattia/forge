# Forge — Phase Roadmap

Phases 1 through 6 are built. This records how the remaining work is decomposed and, more
importantly, **the ordering decisions that exist to avoid rework**. They are easy to get wrong
and expensive to undo.

The spec (`docs/superpowers/specs/2026-09-17-forge-template-design.md` §9) describes the whole
identity platform as one thing. It is not one plan. It is four.

| Phase | Ships | Status |
|---|---|---|
| **1. Generator + template skeleton** | `npm run create` produces a bootable, agent-ready NX monorepo. No auth. | **BUILT** |
| **2. Identity foundation** | Users, auth identities (password provider), sessions with rotating refresh tokens, email verification, password reset, the append-only audit log — and the whole client half: services over the wire, the auth store, route middleware, and the pages a person actually uses. | **BUILT** |
| **3. Organizations + authorization** | Orgs, memberships, invitations, `can()` as pure core logic, roles, per-resource grants, guards — and the whole client half: services, `useCan`, the permission middleware, the pages. | **BUILT** |
| **4. OAuth + account linking** | Google/GitHub/OIDC adapters behind one port, a development adapter that refuses to exist in production, PKCE and single-use authorization rows, the federated sign-in and link decisions as pure core policy, the callback and its refusal page, and linking from account settings. | **BUILT** |
| **5. MFA** | TOTP + WebAuthn as second factors and single-use recovery codes, all three answering one challenge; `SecondFactorSettled` as a compiler-held guarantee that no session opens without one; the challenge page, the security screen and the recovery-codes panel. | **BUILT** |
| **6. Hardening + abuse resistance** | Throttling across every credential and second-factor surface, keyed only on server-known subjects; continuity of control on enrolment; ADR-0013 conformance; and the cheap carried debt from Phase 5 §8. Adds no capability. | **BUILT** |

## The ordering decisions

**1. Phase 2 must build `AuthIdentity` split from `User` immediately** — even though password is the
only provider it ships. A `User` is a person; an `AuthIdentity` is one way to prove you are them.
Get this right in Phase 2 and Phase 4 *adds a provider row*. Get it wrong — auth fields hung off
`User` — and Phase 4 is a migration of every account in every generated project. (Spec ADR-0005.)
**Confirmed by Phase 4:** it added no column to `users` and no migration touching an existing
row. The only new table is `oauth_authorization_requests`, which holds the in-flight
authorization and nothing about an account.

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

## What Phase 5 must not get wrong

Phase 4's own discoveries. Each cost at least a fix round, and several cost a whole task; the
evidence is in `phase-4-decision-log.md`, and **its opening six are the ones to read before
touching the authentication flow.** MFA is the same shape of work as OAuth — a second factor
that decides whether a session is issued — so these transfer almost line for line.

- **A fail-open default on a column the database does not constrain is invisible to every test
  that only exercises legitimate values.** Phase 4's `oauth_authorization_requests.purpose` is
  plain `text` with no `CHECK` — correctly, because every enum-ish column in this schema is —
  and `complete()` dispatched on it with a ternary: `purpose === 'LINK' ? link : signIn`.
  Anything that was not exactly `'LINK'` was treated as a sign-in, and replaying that
  **minted a real, usable session** — an access token and a `SessionRecord` row — for a
  corrupted value. **Phase 5 has at least three columns of exactly this shape**: the challenge
  token's purpose, `MfaMethodType`, and recovery-code state. Branch with explicit equality per
  modelled value and an unconditional refusing fallthrough. **On a security branch the safe
  default is refuse, not proceed.**
- **Grade a finding on more than the axis you are looking at.** That fail-open had **passed a
  full Opus review of the same file**, which correctly verified the write lock, the
  consumed-before-exchange ordering and the policy obedience — and then graded the ternary a
  **Minor**, which was right about defensive-coding hygiene and wrong about what the branch
  does. It became an authentication bypass only when it was ruled up and somebody ran it.
  **Ruling a Minor up was the single most valuable act of the phase.** When a severity is
  assigned, ask what a different axis would say.
- **A test written to match code already written asserts the code, not the requirement — and
  it passes, which is what makes it worse than no test.** Phase 4's signature defect, and the
  same family as Phase 3's tautology rule with the ordering reversed instead of the source
  shared. Its first instance pinned a **fully configured provider being silently absent** as
  intended behaviour. **The tell is local and cheap to check:** when an assertion's expected
  value differs from a sibling's under reasoning that should be identical, one of them encodes
  an accident. Derive the expectation from the requirement, before the code exists.
- **A gate that does not run cannot report drift, and the drift accumulates silently until
  somebody finally runs it.** Two instances in one afternoon: a schema drift probe whose
  expected-table list had gone stale a phase and a half earlier (because that tier was PR-only
  until Phase 3's last task), and **Phase 4 breaking its own end-to-end production test six
  tasks before anyone noticed** — Task 12 added `PUBLIC_API_URL: ${PUBLIC_API_URL:?required}`
  to `compose.prod.yaml` and never ran the production e2e, reasonably, since that was not its
  brief. Both were found by the first person to actually run the tier. **Run the slow tiers
  early in a phase, not at the end**, and when a task changes a compose file or a schema, run
  the tier that would notice.
- **A refusal needs a route, and each half being correct proves nothing about the join.**
  Phase 4 shipped a callback page that rendered all seven refusal messages correctly while
  `landingUrl` sent the browser somewhere else entirely — so the message behind this phase's
  central security property was **displayed nowhere**. Invisible to every test, because the
  page's spec asserted the page and the controller's spec asserted the redirect and **nothing
  asserted they met**. MFA has more refusal endings than OAuth — challenge expired, wrong
  code, replayed recovery code, last method removed without re-authentication. Assert the
  meeting point.
- **A challenge token must be able to do nothing but complete MFA, and its purpose must be
  fixed by which method was called rather than derived from caller input.** Spec §9.3 says the
  first half; the second is Phase 4's mechanism for it, verified: `authorizationUrl` is called
  with exactly `{state, codeChallenge, redirectUri}`, so the purpose and the actor **cannot**
  be derived from anything a caller sends. Copy that shape. And note the other half of the
  lesson — **storing the purpose is only half the property; the reader must refuse a purpose
  it does not model.**
- **Add an `AuthenticationStatus` member *and* a matching variant.** `AuthenticationOutcome` is
  a discriminated union whose variants pin `status` to specific members, so a bare enum member
  adds no variant and `assertNever` still receives `never` — **the exhaustiveness injection
  fails nothing, anywhere.** Phase 3 recorded this; Phase 4 deliberately added no member, so
  Phase 5 is the first to meet it. The union is already shaped to receive `MFA_REQUIRED`; do
  not reshape the login flow to add it.
- **Every new `AuditAction` member must be added to the hand-written pinning map, and that
  failure is the guard working.** The map is deliberately transcribed rather than derived —
  a derived expectation cannot fail for the reason the spec exists. A changed *string value*
  is what nothing else catches: the compiler catches renames, and an append-only table written
  with a value that disagrees with every row already in it is not recoverable.
- **Nothing asserts against the generated dev webapp except two `GET`s.** Every page of it
  returned 500 for days — since Phase 2 — because a globally-registered Nuxt server plugin
  imports core subpaths as values and `libs/core`'s exports map points only at `dist/`, which
  the dev target never built. It was invisible because **nothing in this repository had ever
  made an HTTP request against the dev webapp**; the only live-webapp test curls the production
  image, which is immune. `FORGE_E2E` now fetches `/` and `/login`. **If Phase 5 adds a page in
  the authentication path, add it to that walk** — and if a webapp-facing assertion is needed,
  the compose invocation must include the `webapp` service, which the test's own comment says.
- **Three backend specs flake intermittently and all three present as spurious 401s.**
  `d9-tenant-isolation.spec.ts`, `change-password.spec.ts`, `members.controller.spec.ts` — one
  pattern with three faces, pointing at shared session state across parallel jest workers
  rather than at any of the specs. **`d9-tenant-isolation.spec.ts` is a discriminating security
  test, and a flaky security test's greenness is not evidence.** Investigate as one item with
  an explicit run cap before trusting a green backend suite for a security property.
- **The verified-email challenge for linking is unbuilt, is not MFA's, and must not be folded
  in silently.** Spec §9.3 permits it as an alternative to the authenticated session; R9
  shipped the authenticated session only. See `phase-4-decision-log.md` §7 for what building
  it costs.

**Still binding, unchanged, and each with its evidence in an earlier log:**

- **Never add a foreign key to `audit_entries`** — and `ALTER TABLE audit_entries OWNER TO
  <app role>` voids the guarantee the same way, since the owner is not subject to the `REVOKE`.
- **A green fast tier says nothing about whether the application boots.** Phase 4 confirmed it
  again from the other side: booting the dev stack at Task 12 found `PUBLIC_API_URL` missing
  from **both** compose files, which would have stopped every generated project's dev *and*
  prod stack, and no fast tier could see it because that task was the first time the service's
  constructor ran inside Nest DI at all. `guard-wiring.spec.ts` **discovers** guards from
  `@UseGuards` metadata — add guards to controllers and let discovery find them; do not convert
  that spec back into a list.
- **Prose is part of the artifact and no gate reads it.** Phase 3 shipped five false comments;
  Phase 4 shipped one *in the same commit that wrote the invariant it contradicts* (triage item
  1). When a comment is found false, prefer making it **true**.
- **`can()`'s layer three fires on no route, and D12 is a labelled partial with a tripwire.**
  Phase 4 deliberately tripped nothing — no new `Permission`, no new layer, no `can()` call site
  passing a resource. **The first call site that passes a `resourceType`/`resourceId` trips the
  tripwire and owes D12 a real test**, and makes the `platform:administer` refusal's
  case-sensitivity real.
- **Nothing in the webapp enumerates `Permission`.** The check is a grep and it is manual.
- **`FakeDataSource` enforces no unique constraints and has no foreign keys.** Phase 4's answer
  was to verify the new unique constraint and D11 itself against real Postgres. Do the same.
- **Do not enumerate the bad inputs. Refuse what you do not model.** *"Enumerating the dangerous
  members is the move that failed five times."*
- **A guard's failure message is part of its design**, and Phase 4 added a second form of it:
  a timeout that fires reads identically to the regression the guard exists to catch. When you
  add a wait, check what is already waiting on it.
- **Check whether a fault is fail-closed before writing a test against it**, and measure the
  split rather than arguing it. Phase 4's version: a test that asserts a **success** needs a
  fault of its own, because it stays green against a correct implementation *and* against one
  that is far too permissive.
- **Split any new conformance assertion by who can honestly satisfy it (DEC-1).**
- **`storybook build` exits 0 over an empty module graph**, so that gate is worth exactly what
  its `stories` glob is worth. A green tick is not evidence that any story was compiled — check
  the module count. `apps/webapp/app/test/storybook-config.spec.ts` guards the glob in the fast
  tier.
- **A gate change never rides inside a feature task (R12).** Five applications in Phase 4, and
  one corollary: when the gate gap is found *during* a feature task, the right move is a
  separate commit in the same task, not a deferral.

## What Phase 3 knowingly did not close, and what became of it

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

**2. CLOSED — Storybook. Root-caused, fixed and gated in Phase 4 Task 1 (2026-09-21), and
Phase 3's exit condition is discharged rather than outstanding.** That condition said the job
would flip twice in one commit — `continue-on-error` off, `if:` to `github.event_name !=
'schedule'` — once the `moduleType` failure was understood. Both happened, in that commit, and
the template's own CI gained `build-storybook` in an addendum because a generated project
shipped the same gap one level down. **There is nothing left to satisfy here**; the entry
survives for the lesson at the end of it, and the full write-up is `phase-4-decision-log.md`,
opening item 5. Phase 3's own log §6 entry — *"Storybook's build still fails, root cause still
unknown"* — is superseded by what follows.

It was `✓ 0 modules transformed`, then `[vite:build-html] Missing field
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
count is — **0 before, 604 after, 615 once Phase 4 added its fifth story**, with a deliberate
break made to fail the build *naming the story file* before the number was believed.
`apps/webapp/app/test/storybook-config.spec.ts` asserts in the fast tier that the `stories`
glob still matches real files, because that assumption is the one this job cannot check about
itself. The sharpest evidence is not the passing build: with a broken story, `lint`,
`typecheck`, `test` and `build` **all passed** and only `build-storybook` failed.

## Triage: forty-one minors open — dispositioned by Phase 5

Ledgered rather than looped, per the standing rule. **Phase 4 closed two of Phase 3's
thirteen and deferred thirty of its own**, so eleven carry forward and thirty are new. Full
evidence is in `phase-3-decision-log.md` §8 and `phase-4-decision-log.md` §8; this is the
actionable list.

> **Phase 5 dispositioned all forty-one**, item by item: **11 drained** (those in files it
> opened), **3 closed with no change needed**, **27 still ledgered** (all in files no phase has
> reopened since). The per-item table, with the file and the reason for each, is
> `phase-5-decision-log.md` §7. The list below is retained as written; read it with that table
> beside it.

**Weigh these first**, across both phases:

1. **`auth-init.client.ts` awaits `store.renew()`** (Phase 3 #1) — and its neighbour
   `auth-init.server.ts` is the plugin at the centre of Phase 4's dev-webapp 500. Whoever opens
   one should read both.
2. **A `completeLink` refusal passes `redirectTo` where the same commit's own rewritten TSDoc
   says every refusal of that kind passes `null`** (Phase 4 #1) — a false comment shipped in the
   commit that wrote the invariant.
3. **Two defensive refusal branches write no audit entry** (Phase 4 #2), on the branches whose
   reachability means data is corrupt — which is when a trace is worth most.
4. **`storybook-config.spec.ts` counts only `.stories.ts` while the glob matches five
   extensions** (Phase 4 #4) — the fast-tier guard on the one assumption the Storybook job
   cannot check about itself, undercounting the moment a `.tsx` story lands.
5. **The `platform:administer` refusal is a case-sensitive literal comparison** (Phase 3 #6) —
   pair it with D12's tripwire, because both become real on the same day.
6. **The Docker e2e rewrites `apps/backend/.env` and never restores it** (Phase 4 #10), with no
   warning for whoever adds an OAuth-touching assertion after that point.
7. **Derive the production e2e's required-variable list from `compose.prod.yaml`'s
   `:?required` entries** (Phase 4 #30) — declined correctly at the end of a long task, and it
   is the fix that would have caught Phase 4 breaking its own production test automatically.

### Carried from Phase 3 — eleven still open

| | Item | Cost to close |
|---|---|---|
| 1 | **`auth-init.client.ts` awaits `store.renew()`**, and Nuxt holds the mount for an async plugin — so every full page load for a signed-in visitor inserts a backend round trip before hydration completes, and a hung renewal blocks interactivity indefinitely (`createApiClient` has no timeout). `status` is already seeded, so not awaiting may be strictly better. **Every generated project inherits this.** | One decision plus a test; possibly one line |
| 4 | **`dependsOn` is inert-if-renamed, silently.** Nuxt filters on `p._name`; if `@pinia/nuxt` renames its plugin the belt becomes a no-op with no warning. Harmless today only because the `if`-guard is what actually holds | One sentence in the comment |
| 5 | **`migration-sql.spec.ts` holds two matching styles** — the normalizer for security guards, raw source text for schema-shape assertions. Defensible, but it should be a **stated** split rather than an accident | A paragraph in the file's TSDoc |
| 6 | **The `platform:administer` refusal is a case-sensitive literal comparison.** Inert while layer three is consumed by nothing; becomes real the moment a consumer wires it | Pair with D12's tripwire |
| 7 | **`audit.service.ts` still hand-builds a `Principal` literal** rather than using `PrincipalService` — a second place the principal's shape is stated | Small refactor |
| 8 | **`createOrganization`'s audit test compares against the service's own return value**, unlike its update/delete siblings | Read the value back from the store |
| 9 | **`useInvitations.load` hardcodes the `PENDING` filter**, foreclosing an invitations-history view without a fetcher bypass | A parameter defaulting to `PENDING` |
| 10 | **`api-error-code.spec.ts`'s comment still claims "the same eleven names"**; there are 14 | One line |
| 11 | **No `LoginForm.spec.ts` case for the exhaustive switch** (the typecheck is self-protecting) | ~4 lines |
| 12–13 | **Two near-tautological `fromJSON` round-trip comparisons** in `Organization.spec.ts` and `Membership.spec.ts` — `expect(revived.toJSON()).toEqual(original.toJSON())` restating the `toJSON` tests | Delete the trailing comparison |

**Closed in Phase 4:** #2, the webapp/backend error-code sort-order disagreement — Task 16 kept
`localeCompare` and **documented** in both the type's TSDoc and the spec header that a
seven-code comparator test cannot distinguish the two orderings, rather than claiming a
property the implementer had verified does not hold. And #3, `tools/sanitize.mjs` missing
no-separator compounds — Task 2 added camelCase/PascalCase boundary handling to the content
rules, in its own commit per R12. The path-only `event`/`payment`/`ticket` rule was
deliberately **not** widened and is now Phase 4 triage #21.

Also recorded and deliberately not actioned: the `migration-sql` lint **exemption pin keys on
file + rule name only**, so moving an exemption *within* a file passes silently.

### New in Phase 4 — thirty

Evidence for each is in `phase-4-decision-log.md` §8, numbered the same way.

| | Item |
|---|---|
| 1 | `completeLink`'s null-owner guard passes `redirectTo` where the same commit's TSDoc says every `AUTHORIZATION_UNKNOWN` refusal passes `null`. Untested either way |
| 2 | The corrupted-purpose and null-owner refusal branches write **no audit entry**, unlike every other refusal in the file |
| 3 | `expectOnlyRealAdapters` does not cross-check that the provider in the GITHUB slot is specifically `GitHubOAuthProvider` |
| 4 | `storybook-config.spec.ts` counts `.stories.ts` only, while the glob matches `@(js\|jsx\|mjs\|ts\|tsx)` |
| 5 | `REFRESH_COOKIE.set` runs before `landingUrl` in the callback — unreachable only because `redirectTo` is validated |
| 6 | Two of ~11 `oauth.service.begin` security assertions were reasoned about rather than watched red |
| 7 | `DISCOVERY_PATH` concatenation has no trailing-slash normalisation on `OAUTH_OIDC_ISSUER_URL` |
| 8 | The dev adapter's "no network call" assertion is a literal-text check for `fetch(` — the shape is the plan's, not the implementer's |
| 9 | The dev adapter's `consumed` map is unbounded (dev-only, ~43 bytes per sign-in, every entry dead after the TTL) |
| 10 | The Docker e2e rewrites `apps/backend/.env` and force-recreates the backend, and never restores it — with no warning for the next OAuth-touching assertion |
| 11 | The `record` audit-shape helper is duplicated |
| 12 | The `DevOAuthProvider` S256 fix rode inside the phase's most security-critical commit — my instruction, against R12's spirit |
| 13 | The authorization entity's `purpose!: string` is untyped, and the deliberateness is stated on the migration's column rather than the field |
| 14 | Only 4 of 10 columns get `COMMENT ON`, and the selection is not stated as deliberate |
| 15 | `authorizationUrl` builds its query by string concatenation — correct only while the redirect URI is query-less |
| 16 | The `PUBLIC_API_URL`-omission regression test is nested inside a `describe` about the PF-1 collision, which it does not test |
| 17 | The `AuditAction` value-pinning loop uses `expect().toBe()` rather than `test.each`, so a failure does not name the offending key — and every later phase adding an action will meet that failure |
| 18 | The runtime "every member is in the map" assertion is a weaker backstop behind compile-time completeness (`core:typecheck` catches it either way) |
| 19 | Digit-adjacent sanitize widening (`organizer1`, `x1organizer`) is unstated and untested |
| 20 | Consecutive-capital acronym compounds (`APIOrganizerService`) are not caught by the widened rule |
| 21 | The path-only `event\|payment\|ticket` sanitize rule was not widened — needs basename extraction plus a strictness judgment, in its own task |
| 22 | `tools/sanitize.mjs` excludes itself from its own scan, so its own `"Phase 3."` string is uncaught by the rule Phase 4 added |
| 23 | Two "the brief" instances in `tests/`, which is out of the gate's scope by design |
| 24 | `build-storybook` declares no `outputs` in `targetDefaults` — needs one before any phase publishes the Storybook site |
| 25 | `login.vue` passes no `busy` to `OAuthButtons`, leaving a double-click unguarded before navigation completes |
| 26 | The webapp's `oauth.service.ts` has no `domainErrorFor` — correct, but unexplained in a directory where every sibling has one |
| 27 | `identities.vue` fires `load()` and `loadProviders()` in parallel with `void` in `onMounted` |
| 28 | An optional-chained `federated?.providerAccountId` comparison would read better after an explicit `toBeDefined()` |
| 29 | `FederatedSignInInput.ts`'s TSDoc references `{@link User}` without importing it (established house style) |
| 30 | The production e2e's required-variable list is hand-written rather than derived from `compose.prod.yaml`'s `:?required` entries |

## What Phase 5 inherits, already built

| | Where |
|---|---|
| `IOAuthProvider` + `OAuthProviderRegistry` + `buildOAuthProviders`, with Google, GitHub, generic OIDC and a development adapter behind one port — and two start-up refusals (dev-in-production; dev and real OIDC both configured) | `apps/backend/src/auth/oauth/` |
| `decideFederatedSignIn` and `decideFederatedLink` as pure core policy over discriminated unions, in the domain's own vocabulary ("federated", never "OAuth") — with the link input carrying **no address field**, structurally | `libs/core/src/identities/policies/` |
| `oauth_authorization_requests` — hashed state, PKCE verifier, provider, purpose, optional `user_id`, `expires_at`, `consumed_at`; single-use under a pessimistic write lock, with the named constraint `uq_oauth_authorization_requests_state` | `apps/backend/src/db/`, `apps/backend/src/auth/oauth/` |
| the routes — `GET /auth/oauth/providers` (public), `GET /auth/oauth/:provider` (public, redirects), `GET /auth/oauth/:provider/callback` (public, lets no exception escape), and `POST /users/me/identities/:provider` (authenticated, returns `{ authorizationUrl }`) — with the declaration order of the first two pinned by a test, because Express would otherwise let `:provider` swallow `providers` | `apps/backend/src/auth/oauth/oauth.controller.ts`, `apps/backend/src/identities/identities.controller.ts` |
| `AuditAction` at **33 members**, including `IDENTITY_LINKED`, `FEDERATED_LINK_REFUSED` (actor: the incumbent) and `IDENTITY_LINK_CONFLICT` (actor: the attempter) — with every string value pinned by a **hand-written** map | `libs/core/src/audit/enums/AuditAction.ts` |
| the callback page, `FEDERATED_REFUSAL_CODES` and its message-and-remedy map, `OAuthButtons`, `useOAuthProviders`, the shared `providerLabels` map, and linking/unlinking on the identities screen | `apps/webapp/app/pages/oauth/callback.vue`, `app/types/api.ts`, `app/components/`, `app/composables/`, `app/utils/providerLabels.ts` |
| a Storybook build that compiles **615 modules**, gated on push and PR in Forge's CI *and* in every generated project's own `verify` job | `apps/webapp/.storybook/`, `.github/workflows/ci.yml`, `template/.github/workflows/ci.yml` |
| a sanitize gate at 763 files and **one** deliberate exemption, now with camelCase/PascalCase boundary handling and a rule banning Forge's process vocabulary inside `template/` | `tools/sanitize.mjs` |
| a Docker walk that verifies D11 against **real Postgres** (identity and session counts unchanged, one `FEDERATED_LINK_REFUSED` row), that the production stack refuses to boot with the dev provider enabled (with a `/health`-200 control first), and that the **dev** webapp serves `/` and `/login` | `tests/integration/docker.test.mjs` |
| [ADR-0011](../../template/docs/adrs/0011-federated-identity-never-auto-links.md) — why a federated address links nothing | `template/docs/adrs/` |

## What Phase 4 inherited from Phase 3, already built

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

Phase 4 added two more, both about tests and gates that exist and still prove nothing:

- **A test written to match code already written asserts the code, not the requirement.** It
  passes, which is what makes it worse than no test. Same family as Phase 3's tautology rule
  with the ordering reversed instead of the source shared: there the driver's expectation and
  the implementation's answer came from one source; here the expectation was read off an
  implementation that already existed. Phase 4's first instance pinned a **fully configured
  OAuth provider being silently absent** as intended behaviour, and it passed review. **Derive
  the expectation from the requirement, and write it before the code.**
- **A gate that does not run cannot report drift, and the drift accumulates silently until
  somebody finally runs it.** Phase 3 established that a PR-only gate is not a gate; Phase 4
  measured what the first run after one has been off costs — two unrelated on-the-merits
  failures (a schema drift list stale by a phase and a half, and this phase's own production
  e2e broken six tasks earlier) before a single assertion of the new work got a chance to run.
  **Run the slow tiers early in a phase, not at the end.**

Phase 5 added one, and it is a refinement of Phase 3's prose clause rather than a new
territory — because Phase 3's rule existed, was quoted in every brief, and did not stop the
defect recurring more than fifteen times:

- **A claim that enumerates will go false, however carefully it was checked.** "Both callers
  hold the lock", "eight call sites", "the one place that reads them" — each was *true when
  written*, and each rotted the next time somebody added a caller, silently, in a file no diff
  touches. Care is not the remedy; three authors in a row wrote one `ADR-0012` sentence false,
  each having read the code first, because the enumeration ran three deep across three files.
  **State the invariant, not the enumeration** — "every caller holds a write lock, and nothing
  here enforces that" survives a fourth caller and says more. Correcting a count merely resets
  the clock.

The rulings behind all seven, and everything else decided along the way, are in
`phase-1-decision-log.md` through `phase-5-decision-log.md`. Read the second one's opening five
before touching the identity foundation, the third's before touching authorization, tenancy or
the migration guards, **the fourth's opening six before touching authentication, the OAuth flow
or any gate**, and **the fifth's opening section before writing any comment that counts
something.**

---

## What Phase 6 inherits, already built

| | Where |
|---|---|
| TOTP enrollment and verification, WebAuthn/passkeys as a second factor, and single-use recovery codes — all three answering one `mfa_challenges` challenge, with the purpose allowlist held separate from the `purpose !== expected` comparison so an unmodelled purpose stays refused when a third member joins the enum | `apps/backend/src/mfa/` |
| `SecondFactorSettled` — a session cannot be opened without it, enforced by a private member and a private constructor, with **five `@ts-expect-error` directives that fail the build on exactly the change that would reopen the hole**. Live in one tier: `npm run typecheck` and CI's `nx affected -t typecheck`, **not** under jest (`isolatedModules` means ts-jest transpiles without checking) | `apps/backend/src/auth/session/second-factor-settled.ts` |
| `decideAuthenticationStep` and `decideMfaRemoval` as pure core policy — counting **confirmed** methods only, so an unconfirmed method is no gate at all | `libs/core/src/mfa/policies/` |
| `mfa_methods`, `mfa_recovery_codes`, `mfa_challenges` — `type` and `purpose` plain `text` with no CHECK, deliberately; single-use enforced by one conditional `UPDATE` under a pessimistic write lock | `apps/backend/src/db/migrations/1758000005000-Mfa.ts` |
| `AuditAction` at **41 members** — Phase 5 added eight, including `MFA_CHALLENGE_ISSUED` and `FEDERATED_AUTHORIZATION_CORRUPT` — with every string value still pinned by a **hand-written** map | `libs/core/src/audit/enums/AuditAction.ts` |
| the challenge page (`ssr: false`, URL stripped via `replaceState`, `no-referrer`), the security screen, and the recovery-codes panel | `apps/webapp/app/pages/mfa/`, `app/pages/account/security.vue`, `app/components/organisms/` |
| **ADR-0012** — a second factor belongs to the account, not to the road in; the federated callback asks too | `template/docs/adrs/0012-…` |

**What Phase 5 knowingly did not close** is `phase-5-decision-log.md` §8. Weigh **throttling**
first: nothing anywhere limits code submission or challenge minting, and a 6-digit TOTP code
with unlimited attempts is a 6-digit code.

**What Phase 6 knowingly defers to Phase 7**, beyond §8's own residue: no OpenAPI document is
generated, although the framework ships `@nestjs/swagger` and every DTO already carries the
validation decorators it derives from. Nothing is duplicated today, so it is a recommendation
rather than a defect — but the webapp's service layer is written by hand against a contract
that exists only as backend source, and that is where the first drift will appear. Phase 6
left it out because it would add a surface to every controller in the workspace, which is a
poor companion to a phase whose other changes are security-bearing and want a small diff.

## What Phase 7 inherits

Phase 6 closed throttling, continuity of control on enrolment, and ADR-0013 conformance. Three
things were decided against rather than left undone, so nobody reopens them as oversights:

- **Recovery codes issued before the alphabet change do not redeem, and no transition path was
  built.** `consume` normalises before hashing, so an old base64url digest never matches, and
  there is no administrator reset anywhere in the backend — a person holding only old codes has
  no route back. Accepting both encodings was considered and refused on the grounds that
  nothing is deployed yet and the dual path would be permanent surface to carry. If that stops
  being true before a generated project ships to real users, this is the decision to revisit
  first. The breaking note is in `apps/backend/CHANGELOG.md`.
- **A throttled person sees the generic failure message.** `TOO_MANY_ATTEMPTS` is pinned in the
  webapp's code list, so the invariant that both copies match is intact, but no copy was
  written: no enrolment path maps an error code to a message today, and adding one for a single
  code would mean a mechanism rather than a string.
- **`@nestjs/swagger` is still not wired.** The webapp's service layer is written by hand
  against a contract that exists only as backend source, which is where the first drift will
  appear.

**What Phase 6 would tell Phase 7 about its own gates:** `coverage` is a separate nx target and
`libs/core` enforces 100%, so `-t test lint typecheck` passes while it fails — that is how an
error class reached core with no core test through fourteen task reviews and a whole-branch
review. And `FORGE_E2E=1 npm test` runs the unit tier and nothing else; the slow tiers are
`npm run test:integration`. Both traps were already recorded before this phase and both were
walked into anyway.
