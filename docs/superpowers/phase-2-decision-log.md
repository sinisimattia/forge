# Phase 2 — Decision Log

The rulings made while building Forge's Phase 2 — the identity foundation — preserved from
the execution ledger so they survive it. Each records what was decided, why, and what it
costs if the decision was wrong.

Read this before reversing anything here. Most of these look like taste and are not: they
were made after a specific failure was observed, reproduced, and usually measured.

This log's companion is `phase-1-decision-log.md`, whose most-used section turned out to be
its list of places the plan was wrong. Phase 2's equivalent is longer, and is
[§3](#3-where-the-plan-was-wrong-and-an-implementer-caught-it-by-testing-first).

---

## The five worth knowing before you touch the code

1. **The append-only audit log is a database privilege, not a coding convention — and four
   ordinary-looking changes silently void it.** The application connects as a role that
   holds no `UPDATE` or `DELETE` on `audit_entries`. Adding a foreign key to that table
   defeats the whole thing, because a referential action runs with the *table owner's*
   privileges: with `ON DELETE CASCADE`, an application role refused a direct `UPDATE`
   deleted the audit rows anyway by deleting the user. `TRUNCATE` is a separate privilege
   from `DELETE`. `ALTER DEFAULT PRIVILEGES` is standing configuration, so re-creating the
   table restores both privileges with no grant written anywhere. A **column-level** grant
   is invisible to a table-level check. And none of it applies if the application connects
   as the owner. All five verified at PostgreSQL 16; see
   [ADR-0009](../../template/docs/adrs/0009-two-database-roles.md).

2. **The tests could not see the application.** A review injected sixteen deletions of
   shipped wiring — the global guard, the validation pipe, the exception filter, `secure`
   on the production cookie, a 365-day credential lifetime — and **fifteen of them left all
   165 tests green**, five being silent security regressions. Every behavioural spec
   assembled its own Nest testing module, so none of them ever observed the artifact that
   ships. The rule that came out of it is **import the artifact, do not rebuild it**, and
   `apps/backend/src/__tests__/composition-root.spec.ts` now carries a table of 24 deletions
   with the test each one turns red. The webapp's analogue — a plugin and route middleware
   registered *by file location*, invisible to any spec that imports the function — has 17.

3. **Enumeration safety (D7) is undone by a helpful message, and just as easily by a helpful
   attribute.** Sign-in answers identically whether the address is unknown, the secret is
   wrong, or the account is suspended, unverified or deleted. The client assertion that
   holds up the other half compared `wrapper.text()`, which is `textContent` and discards
   every attribute — four differentiators with byte-identical text all passed it. Re-derived
   for this log: `:title`, `:aria-live`, `:class` and `:data-failure` each pass 6/6 under
   `.text()` and each fail under the shipped `.html()`. The `title` case republishes as a
   native tooltip, read aloud by assistive technology, exactly what the backend's identical
   `401` withholds; the `aria-live` case arrives looking like an accessibility improvement.
   *Both look like kindnesses.*

4. **`libs/core` is an executable contract, and it is driven from both sides on purpose
   (DEC-1).** The same conformance suites run against the backend's services under jest and
   against the webapp's HTTP services under vitest. That is not symmetry for its own sake:
   driving them from the webapp found **three real backend defects the backend's own
   conformance run could not see**, because only the webapp crosses the serialization
   boundary — two `410` responses separable only by translated prose, a route that never
   existed behind a method that was being tested, and a domain error with no name on the
   wire.

5. **The access token travels in the server-rendered payload.** Deliberate, documented, and
   mitigated with `cache-control: private, no-store` — which closes shared caches and does
   *not* close response-body logging, APM capture, a saved page, the back-forward cache, or
   a DOM-capturing error reporter. **This one is for Mattia to ratify rather than inherit**;
   see [§6](#6-for-mattia-the-ssr-payload).

---

## 1. The formulations that earned their place

Quoted verbatim, attributed to the round that produced them, because each one changed how a
later task worked.

> **"A claim whose subject has no test is a claim about nothing."**
> — Task 12, fix round 3, crystallising instance nine of the phase's signature defect: a
> paragraph titled "Written on both outcomes" sat above a `catchError` branch that no test
> exercised. The sentence was *true* when written, and its truth depended on a branch that
> could be deleted with 379/379 still green. Asking "what breaks if I delete this?" of the
> **comment** would have found it, because the answer was "nothing, and nothing would notice
> the code going either."

> **"A value that is always a lie is worse than an absent one, because the type calls it
> knowledge."**
> — Task 15's reviewer, on why `AuthenticationRejectionReason` gained an explicit
> `UNDISCLOSED` member rather than becoming optional. Five rejection reasons collapse to one
> `401`, so a client that reports any of them reports a fabrication. An optional field
> invites `reason ?? something` at every call site; a member forces every exhaustive switch
> to handle the client's ignorance as the real state it is. Task 17 then read `reason`
> nowhere at all, because there was nothing to fabricate from.

> **"Both look like kindnesses."**
> — Task 17, on the two attribute-borne ways to break D7 that a reviewer would wave through:
> a `title` tooltip and an `aria-live` politeness level. It is the last line of the comment
> above the assertion it explains, in `LoginForm.spec.ts`.

> **An inert grep that reads clean and a build command that exits 0 without running are the
> same defect wearing different clothes: a check that passes because it never ran.**
> — Task 14's fix round, connecting two findings nobody had connected. W1 was a
> `grep -rn '~/components' app/components/` over a tree containing two import statements,
> neither a component — zero hits on every possible input, indistinguishable from
> compliance. In the same week, `npm run build-storybook` was returning exit 0 with a
> one-line log and no output directory. This is the sentence the phase is organised around,
> and it is why `check-atomic-layers.mjs` **fails when it is pointed at nothing** rather than
> reporting a clean scan of zero files.

---

## 2. The measurements

These are what make the argument rather than decorate it. Historical figures carry the
commit they were taken at; anything without one was re-derived for this log against the
tree as it stands.

### What the conformance suites bought

Two properties that **nothing in the 392 pre-existing backend tests could see**, each first
pinned when core's suites were driven against the real services (Task 13, at `3c0b594`):

| Fault | Then | Re-derived now (backend at 499 tests) |
|---|---|---|
| `FakeRepository.find` accepts an `order` option and discards it, so `listActive`'s "newest first" promise is decided by insertion order | **exactly 1 failure in 478**, and it is a conformance test | **1 failed / 499** — `IAuthService conformance › sessions › adds a fresh sign-in to the actor's own sessions, newest first` |
| the session row's client columns are written `null` — the exact fault the shared suite's comment says it exists to catch | **exactly 1 failure in 478**, the new wire-shape test | **2 failed / 499** |

The second row is not a correction of the original measurement; it is the effect of a later
decision. Task 15 moved the client-context assertion out of the shared suite into the
backend-only security suite (a client cannot honestly assert its own IP), and that **added a
second catcher** — measured there as "2 failed of 77". Anyone quoting "1 in 478" today for
both properties would be quoting a number the ledger had already superseded.

### What the composition root was worth

| | |
|---|---|
| deletions of shipped wiring a review injected (Task 11, at `43bf255`) | **16** |
| of those, leaving **all 165 tests green** | **15** |
| of those fifteen, silent security regressions | **5** — the exception filter (re-opening a 500 on every domain refusal), the global validation pipe (all DTO validation gone), `secure` never set in production, `ignoreExpiration: true`, a credential accepted from `?access_token=` |
| guarded deletions after Task 11's fix round (`c9d18f0`) | **19** |
| **rows in the table today** | **24** — Task 11's fix round 2 and Task 12 added five more |
| webapp wiring deletions guarded (Task 16, before → after its fix round) | **15 → 17** |

The only one of the sixteen that fired unaided is the one that explains the rest:
`REFRESH_COOKIE` is a shipped module the spec *imports* rather than re-declares.

A sixteenth fault, found in the fix itself, is the sharpest: dropping `JwtStrategy` from
`AuthModule`'s providers left 199 green — passport has no `jwt` strategy, every
authenticated route fails at runtime, and `@Public()` `/health` still answers 200, so **the
container reports healthy while authentication is entirely broken**. The probe had hidden it
by registering `JwtStrategy` itself.

### D7's client assertion

Re-derived. One fixed failure string, three distinct failures driven through the real
store, service and fetchers, and a differentiator carried on an attribute instead of in the
text:

| Differentiator | under `.text()` (the shipped assertion before Task 17's fix) | under `.html()` (shipped now) |
|---|---|---|
| `:title` | 6 passed | 1 failed of 6 |
| `:aria-live` | 6 passed | 1 failed of 6 |
| `:class` | 6 passed | 1 failed of 6 |
| `:data-failure` | 6 passed | 1 failed of 6 |

Clean tree 6/6 under both, so the fix is shown to be what closed it rather than merely to
coexist with it closed. One honest qualification, worth stating because it bounds the claim:
the component cannot distinguish an unknown address from a wrong password *at all* — the
wire does not tell it — so these injections differentiate a transport fault from a refusal.
The account-existence property itself is held upstream, by the backend's byte-identical
`401` and by `UNDISCLOSED`.

### Other measurements worth keeping

- **T6-F1, measured before it was fixed:** with `openSession` discarding the `ClientContext`
  entirely and the committed suite restored, **212/212 green**. Post-fix the same injection
  gives exactly one failure. Second time in the phase a suite was shown to pass against a
  genuinely broken implementation, and both times the measurement settled what an argument
  would not have.
- **`changePassword`'s statement ordering — which its own comment calls "the property" —
  was enforced by nothing:** swapping `sessions.begin` before `auth.changePassword` left
  **347/347 green**. Invisible because the controller spec used a fake service with canned
  session tokens, which is the exact arrangement that task's own D7 work had just rejected.
- **Atomicity was not merely untested, it was unfalsifiable.** Fixing `changePassword`
  required teaching `FakeDataSource` to roll back first, because no test in the backend had
  the vocabulary to state the property. That is the expensive shape: not a test that misses
  a bug, but a double that cannot express what is being claimed.
- **Task 12 injected 37 faults one at a time; 33 went red and the 4 that stayed green were
  real holes**, closed and re-verified. A ratio, rather than a demonstration.
- **Task 19's walk: 5 of 5 injections fired, and the two that needed a second round are
  findings about the tests.** Removing the reuse branch alone does *not* fail the walk — an
  `affected !== 1` backstop catches it, exactly as that code's own comment predicted — so a
  single-mechanism injection is insufficient to prove that walk discriminates. And with the
  start-up privilege guard in place, removing the `REVOKE` stops the backend booting at all,
  so D13's assertions never run: the guard changed what a D13 injection even means.
- **The temp leak:** 2,624 directories and 23 GB across five `mkdtemp` prefixes, dating to
  Phase 1, on a machine that had already had a disk-exhaustion incident crash an unrelated
  live Postgres mid-transaction.
- **`npm install` was not tolerating a desynced lockfile, it was erasing the evidence.**
  With a package absent from the lockfile: the gate as it now stands fails with
  `EUSAGE … Missing: left-pad@1.3.0 from lock file`; the old gate exited 0, fetched it, and
  silently rewrote the generated lockfile. `npm ci` also turned out to be *faster* (14.3s
  against 14.9s).
- **Generated-project gate wall-clock, measured here:** `duration_ms 74284` for the whole
  file — two generate-and-install cycles plus lint, typecheck, test, build, purity, layers,
  the D2/D14 injections, the process-layer inventory and D5. Phase 1's was ~125s for roughly
  a tenth of the surface.

---

## 3. Where the plan was wrong, and an implementer caught it by testing first

Phase 1's log says this is its most valuable section. This phase's is longer:
**thirty-five distinct episodes**, of which the thirty-three below are tied to a numbered
step. The pattern across them is more useful than any one row.

| # | Task | What the brief or plan said | What testing found |
|---|---|---|---|
| 1 | 1 | the `paths` entry causes the dist-layout shift; rewrite `start:prod`, `migration:run:prod` and the prod `CMD` to the drifted paths | `paths` present + no core import still emits `dist/main.js` — the shift needs an actual import. Applying the brief verbatim would have made `npm run start:prod` fail with `MODULE_NOT_FOUND` for three tasks. Its correction — pin `rootDir` so the layout is identical either way — is better than what was prescribed |
| 2 | 1 | Task 1 adds `./shared/policies` to core's `exports`; Task 2's step 4 assigns the same edit | a self-contradiction. The implementer left the file alone and said so |
| 3 | 1 | five enumerations of the subpaths | six; `libs/core/jest.config.js` was omitted |
| 4 | 1 | the core self-`paths` discrimination case fails with `TS2307` | `TS2209`, and independent of whether `dist` exists |
| 5 | 2, 4, 5, 6 | "Modify: package.json, tsconfig.json, jest.config.js" to declare each new subpath | stale after Task 1 wildcarded them. Three more implementers would have re-added per-subpath entries and quietly undone Task 1's central decision, each edit locally correct and passing its own gates |
| 6 | 4 | inject the D3 fault against the trimming assertion | `User`'s constructor trims and `fromJSON` routes through it, so **no implementation returning a `User` can fail it**. Proved by making the reference implementation actively *pad* the name — strictly worse than not trimming — and watching all 64 tests pass |
| 7 | 4 | "confirm 100% coverage via `nx test`" | `nx test core` is a bare `jest` and collects no coverage. Worse: the template's own CI never invokes `test:coverage`, so core's thresholds were enforced in no generated project's CI |
| 8 | 4 | file list with no errors spec | 100% coverage is unreachable without one, because the error is constructed by nothing until Task 11. The identical omission recurred in Task 5 — a systematic gap in the file lists, not a slip |
| 9 | 4 | drive the suites with jest's `describe`/`it`/`expect` | `ConformanceExpect` is a three-method surface, not a matcher chain, so jest's `expect` cannot be cast through it. The same error sat in Task 13's and Task 16's driver snippets and was corrected there before either ran |
| 10 | 4 | — | `libs/core/README.md` was stale in the section that teaches "how to add a domain", and would have mis-taught Tasks 5–7 |
| 11 | 4 | the wire-shape test is "the one that earns DEC-1" | it round-tripped an entity through its own `toJSON`/`fromJSON` and compared it to itself. Once the value is an entity the implementation has left the picture |
| 12 | 4 | the suite obliges the last administrator to be able to demote itself | Task 12's own brief forbids exactly that. A suite and a brief in direct contradiction would have left Task 12 unable to satisfy both |
| 13 | 5 | an empty identity list throws `LastIdentityRemovalError` | it yields `IdentityNotFoundError` — the not-found check runs first. The implementer read the code rather than the headline |
| 14 | 5 | `PasswordPolicyViolation` is an enum; two files omitted; `DEFAULT_PASSWORD_POLICY` unhoused | a string union (`types/` forbids runtime values), both files required, and the policy belongs in `policies/` |
| 15 | 6 | `changePassword` "ends every other session" | not expressible on `IAuthService` as briefed — there is no session id parameter, and ADR-0007 forbids resolving the current session from ambient state. Adding a parameter is not the fix: the webapp never sees a session id |
| 16 | 7 | four things at once — file list, an errors folder, two filter assertions, a shape assertion | the props type is not optional; **no errors folder is the design** (`record()` promises never to reject for a business reason); the two filter assertions left their connecting property unpinned, both satisfied by an implementation that ORs them; and the shape assertion could pass **vacuously**, because a prototype scan finds nothing for instance arrow properties and a search that found nothing satisfies a forbidden-name rule without having looked |
| 17 | 8 | the app role is `__FORGE_NAME___app`, validated by `/^[a-z_][a-z0-9_]{0,62}$/` | `__FORGE_NAME___app` **is not a resolvable token** — `TOKEN_PATTERN` backtracks and yields `__FORGE_NAME___`, which is not in the map, so generation fails. Corrected to `__FORGE_NAME__-app`, which makes the role name unavoidably hyphenated — so the prescribed regex would have **thrown on every generated project** |
| 18 | 8 | dev compose needs a `migrate` one-shot | retracted whole: the dev backend's Dockerfile `CMD` has self-migrated since Phase 1. Reasoned from `compose.yaml` and never opened the Dockerfile |
| 19 | 8 | assert that the app role's `GRANT UPDATE … TO itself` **fails** | it does not fail. Postgres emits `WARNING: no privileges were granted`, reports `GRANT`, exits 0. An assertion written that way passes today for the wrong reason and **keeps passing if the privilege is genuinely regranted** |
| 20 | 8 | "not `CASCADE`" for `audit_entries`' foreign key | necessary and nowhere near sufficient. `ON DELETE SET NULL` erases `actor_user_id` just as effectively, because referential actions run with the owner's privileges. The only foreign key that preserves the entry is **no foreign key** |
| 21 | 8 | TypeORM holds a migration lock, so the check-then-create race is covered | there is no such lock. `grep -rn "advisory\|pg_advisory\|LOCK TABLE"` over `MigrationExecutor.js` and `PostgresQueryRunner.js` exits 1 |
| 22 | 9 | the task is a three-way library decision, because a macOS lockfile will not carry Linux binaries into `node:22-bookworm-slim` | **the central premise was false.** `argon2@0.44` bundles all eleven platform prebuilds in one tarball, so the lockfile entry is platform-neutral, `npm ci` compiles nothing, and all three options were moot. Verified at the published artifact rather than by building — a property of the artifact cannot vary by host, so it is the stronger check *and* the cheaper one |
| 23 | 10 | assert the verification link is built from `PUBLIC_WEBAPP_URL`, "not from any request value" | structurally unfailable: the template function has no request parameter, so the assertion restates the signature. Replaced with a behavioural one — change the configured URL, assert the link's origin changes — which catches a hard-coded origin |
| 24 | 11 | `register()` consults the breach registry, "(the no-op implementation ships)" | nothing implemented that interface anywhere, and the file list did not mention one |
| 25 | 11 | eleven further things | `@nestjs/jwt` and `@nestjs/passport` 12.x are ESM-only and unloadable by this jest; `implements IAuthService` forced Task 12's methods to be built early; every core `DomainError` mapped to a 500; `GET /health` needed `@Public()` or the stack never boots |
| 26 | 11 | inject D6 by removing the `APP_GUARD` provider | the injection **did not test the thing that ships**: `tsc`, `eslint` and all 164 tests stayed green with every endpoint open, because every spec registers its own guard. This is the finding of the phase — see §2 |
| 27 | 11 | registration's existing-account branch audits `EMAIL_VERIFICATION_REQUESTED` | no verification was requested; an "you already have an account" message was sent instead. Recording a false action destroys exactly the property that branch exists to preserve, in a table that physically refuses `UPDATE` |
| 28 | 12 | drive the real controller for D7 "against fake services" | a fake returning a fixed response cannot distinguish a known address from an unknown one, so a whole class of comparison would pass by construction. Driving the real `AuthService` over `FakeDataSource` instead is what made the comparisons failable *(see §4.12 — my recorded reason for this was itself an overreach)* |
| 29 | 13 | build an `InMemoryRepository` with "a `manager.transaction` that simply runs the callback" and an honesty comment saying it does not roll back | `FakeDataSource` already existed, 492 lines, with a superset of the briefed API — **and it does roll back**. Building the briefed version would have shipped a strictly weaker second double and reintroduced a concurrency bug Task 12 had just spent a round fixing. The brief's honesty comment was a false sentence handed over *by the brief itself* |
| 30 | 15 | drive three shared suites under vitest | the file list had no vitest `ConformanceExpect` adapter, and Task 13's jest adapter is explicitly not copyable |
| 31 | 16 | nine things, two of them user-facing bugs | `createAuthFetch` renewing on **every** 401 — a refused sign-in is a bare 401 with no `code`, identical to the guard's, so **a mistyped password reported a refusal and signed the visitor out**. And `app/composables/index.ts` must not exist: Nuxt auto-imports that directory, so a barrel double-registers every name |
| 32 | 17 | build `PasswordField` by composing `FormField` | a molecule importing a molecule — a W1 violation, caught by the layer checker Task 14 had built to replace the inert grep, on its first real three-level run, against an error in the plan rather than in the code |
| 33 | 19 | "the pre-reset access token → 401" and "`GET /users/me` with the new access token → 401" | **both answer 200, by design.** `jwt.strategy.ts` reads nothing from the database, so a revoked session leaves its access credential alive for up to 900 seconds. Task 16 had raised this, and the ledger recorded "Tasks 16/19 must not assume otherwise" — and then a brief was written that assumed otherwise. Also: verify-email and reset-password return 200 not 204, and the sessions route is `GET /auth/sessions`, not `/users/me/sessions` |

**What the pattern says.** Two kinds dominate, and they are not the same kind. About a third
are *stale*: a fact that was true when written and had moved (5, 10, 18, 29, 34 below).
Most of the rest are *unfailable*: an assertion, an injection or a guard that could not have
failed, and would have shipped looking like evidence (6, 11, 16, 23, 26, 28). The second
kind is the dangerous one, because it survives review — a test that cannot fail reads
exactly like a test that passes.

Two more, not in the table because they are about the process rather than a step:

34. **Task 18's brief permitted modifying `tools/sanitize.mjs` "only if Task 8 or 10
    established a genuine need".** Written before the phase ran; the real history by then was
    four narrowings, three of them dedicated interstitials dispatched the moment a feature
    task bent around the gate.
35. **Task 10's brief predicted a sanitize trip on `PASSWORD` in `reset-password.ts`.** It
    did not happen. A different one did, on `TOKEN`.

---

## 4. My own claims, corrected — counted honestly

Eighteen. The ledger's own running counter reached "eighth this phase" at Task 12 and kept
going. Three of them share a shape that matters more than any individual correction.

**The amplification pattern — three instances, named in the ledger as they happened.** In
each, an agent's report contained an unverified number, I wrote it into a durable place
without measuring it, and in one case it reached my human partner before anyone checked:

1. **"All patch-level, no removals, no major/minor jumps"** (Task 9). The second clause was
   verified; the first was not, and was false — `node-addon-api` 7.1.1 → 8.9.2 is a major.
   I had written it into the plan's Global Constraints as *the shape a future lockfile
   refresh must have*, which would have made a legitimate major bump look like a defect in
   every later task. The mechanism is the lesson: a claim in a subagent report became a
   standing rule within one turn, and the part of the report I chose to verify was the part
   I found interesting (removals) rather than the part that was load-bearing for the rule I
   was writing.
2. **"Seven `IAuthService` methods have no tests"** (Task 11's review → Task 12's plan
   amendment). Three agents asserted three different numbers — seven, four, ten — because
   each counted a different thing and none said which. The interface declares **ten**. Fixed
   by replacing the count with an instruction to read the interface: a number no one can
   reproduce is worse than no number.
3. **"Six of the seven domain-trace leaks would have passed `npm run sanitize`"** (Task 14).
   It is **four of seven** — the reviewer ran all seven original lines through the real gate
   and three are caught. I repeated the implementer's count without measuring it, wrote it
   in the ledger, *and told Mattia*. The substantive point survives — the gate is not a
   trace detector, and the hand sweep is what catches prose leaks — but the number was mine
   to verify.

The other fifteen:

4. **The plan carried a disproven sentence I had written next to its own correction**
   (Task 1). My docs commit fixed the mechanism and left "the backend never consumes core's
   dist at all" a few lines below, making the plan self-contradictory in the file Task 4
   would read next.
5. **"Not-found-first prevents an enumeration oracle"** (Task 5) — backwards. Enumerated it
   afterwards: count-first reveals strictly *less*, so the leak argument favours the order
   we do not use. The order is still right, for a different reason: `LastIdentityRemovalError`
   would be a false statement about an identity the account never held. A security-shaped
   justification that sounds right is the easiest kind to ship unchecked, and I had the
   tools to check it in thirty seconds.
6. **My sanitize narrowing regressed the gate on non-TypeScript files** (Task 5). I verified
   it against the false positives in front of me, all of which were TypeScript, and never
   asked what it did to the file types the rule was written for:
   `POSTGRES_PASSWORD: "password"` in a compose file stopped being flagged.
7. **My prescribed fix for the case-sensitivity hole was itself wrong** (interlude, third
   time on that one rule). I said keep the `i` flag and compare case-sensitively in a
   callback; that leaves `password: 'password'` exempt, which my own required-behaviour list
   in the same message says must flag.
8. **The role-name token spelling** (Task 8) — see §3 #17.
9. **The dev `migrate` one-shot** (Task 8) — see §3 #18, retracted whole.
10. **The "GRANT must fail" assertion form** (Task 8) — inherited from the brief and passed
    on unchecked.
11. **The TypeORM advisory lock that does not exist** (Task 8), asserted to justify a
    recommendation that was right for a different reason.
12. **"A fake service would make every comparison unfailable"** (Task 12). The reviewer
    tested it: a fake modelling `REJECTED/UNKNOWN_ACCOUNT` versus `BAD_SECRET` would have
    caught two of the three injections. The decision was right; the stated reason was not,
    and I had repeated an implementer's justification into the ledger before anyone checked
    it.
13. **`asOf = new Date()`** (Task 12) — read in the handler, *after* the guard has stamped
    this request's own override, so the traversal's first entry falls inside its own bound.
    Found by running it. The implementer's alternative — the newest returned row's instant —
    is exact rather than probabilistic and invents no instant.
14. **And the same bug again, in the branch nobody asserted** (Task 12): `boundFor`'s
    empty-page case returned `new Date()`, so a filtered empty first page echoed a bound
    that included the traversal's own override.
15. **"`I18nContext` being undefined is the only thing preventing the args leak"**
    (Task 11) — interpolation also needs a declared placeholder, so `args` alone never
    leaked. Corrected by the implementer, which is what made a real leak injectable.
16. **A paraphrase presented as a verbatim quote** (Task 7). A re-reviewer diffed my quoted
    sentence against the report and found four alterations, one dropping the clause that
    carried the distinction. In a plan whose standing rule is that a claim about evidence is
    not evidence, quoted text has to be the text — and I wrote that rule.
17. **The start-up privilege guard I specified had a blind spot, and its docstring denied
    it** (Task 19). `has_table_privilege` answers `f` while a column-level
    `GRANT UPDATE (action)` is in force, so the process **booted, served `/health`, and
    logged "audit_entries is append-only to this connection" — a false claim, printed by the
    guard itself.** Closed with `has_any_column_privilege`.
18. **"Nobody has reproduced the Storybook failure this phase"** (Task 14) — superseded four
    tasks later when Task 17's reviewer reproduced it exactly. Recorded here because the
    close-out would otherwise have repeated it.

Two smaller ones, for completeness: I wrote `npm run layers` as a root-level script in
several dispatches when it is `-w apps/webapp` or the nx target; and I let a fix round ship
a `{@link}` diagnosis of "cannot fail" that was a shade too strong — post-construction
mutation is a real failure mode, because TypeScript's `readonly` is erased at runtime.

---

## 5. The rulings

### Structure and layering

**`can()` lives in `libs/core/src/authorization/`, not in `shared/`.** `shared/` is for
primitives with no domain dependencies — `assertNever` and `normalizeEmail` are the members
— and `can()` imports `PlatformRole` from `users/`, which inverts what the folder name
promises. Moved during Task 12 rather than later, because Task 15's webapp imports it and
moving afterwards costs a second set of call sites. *Cost if wrong: a file move and one
`exports` entry, done twice.*

**ADR-0006 was satisfied by nothing until Task 12.** "Authorization is a pure function in
core" was implemented nowhere, so the backend inventing a local `PLATFORM_ADMIN` check was
the only thing it could have done. Task 11 marked its local check with a pointer to the
obligation; Task 12 created the policy and routed both call sites through it. An unmarked
local check reads as intentional and survives forever. *Cost if wrong: one authorization
check in the wrong layer for one task.*

**Persistence classes are `<Thing>Record` in `<thing>-record.entity.ts`, with an explicit
`@Entity('<table_name>')`.** `libs/core` exports `User`, `AuthIdentity`, `Session` and
`AuditEntry`, and a repository imports the domain entity and the row class in the same file;
identical names force an alias at every import site, and an alias is a naming decision
re-made by whoever writes each file. The explicit table name is what keeps a future class
rename from silently renaming a table. *Cost if wrong: a mechanical rename in one task's
own files.*

**The subpath declaration is `libs/core/package.json`'s `exports`, and nowhere else.**
Every other resolution point is a wildcard. This is the decision the stale file lists in
Tasks 2, 4, 5 and 6 would have undone one edit at a time.

### The two database roles

Recorded in full in [ADR-0009](../../template/docs/adrs/0009-two-database-roles.md), which
exists because Task 8's brief told its implementer to cite ADR-0008 and the implementer read
ADR-0008, found it is about external capabilities being ports rather than vendor bindings,
and **refused to paste a citation that is true elsewhere and false there.** That refusal was
correct and it left the most structurally binding decision in the backend with no ADR at
all. Every claim in ADR-0009 was re-derived at PostgreSQL 16.14 for this close-out.

**D13 is a property of the process, not of the deployment.** `data-source.ts` falls back to
`DATABASE_URL` when `MIGRATION_DATABASE_URL` is unset, so a deployment that is neither
compose file can migrate as the application role, end up with an app role that *owns* its
tables, and lose the guarantee with no signal anywhere. A warning was rejected — it fires on
every run of the misconfigured deployment, which is noise — and refusing to migrate was
rejected too, because the fallback exists for a good reason. The answer is one query at
bootstrap and a refusal to **serve**: the project still migrates, it declines to serve over
an over-privileged connection. This has no false positives, because in a correct deployment
the role genuinely lacks the privilege. *Cost if wrong: a deployment that deliberately wants
one role cannot boot without an override.*

**Enum columns stay `text` with no `CHECK`.** `users.status` and `platform_role` are small
stable sets where a `CHECK` would catch what the compiler cannot; `AuditAction` grows every
phase and a `CHECK` would make each new member a migration against the append-only table.
One rule applied uniformly beats two rules applied by judgement. *Cost if wrong: a bad enum
string reaches a column that will accept it.*

### The contracts, and how they are tested

**DEC-1: the conformance suites are split.** Assertions both implementations can satisfy
live in the shared suite; assertions only a server can satisfy live in a backend-only
security suite. The split is not a convenience — Task 15 found a shared assertion the webapp
could satisfy only by having its stub *lie* about a client IP a browser cannot know, and the
precedent already existed one field over (`reason` is asserted only in the security suite).
Moving it there was motivated by honesty and **also strengthened coverage**: the same
injected fault then failed two tests instead of one.

**Five rules every conformance suite in this phase follows**, each written after the defect
it prevents was found in a shipped suite:

1. An assertion an entity's own invariants make unfailable is not an assertion. This class
   appeared in **all four** suites, and the fourth time the cause was a copied
   *justification* rather than a copied assertion — a rationale carried across with the
   pattern it justifies survives review precisely because it reads as considered.
2. Prove the return is a real entity, not the raw shape a store handed over — with the
   indirect case named where it is relied on.
3. Compare service output against the world, never against itself.
4. Assert a fixture default against a literal, never against a function of the value under
   test.
5. Never round-trip a value through the entity on the way to the comparison: it re-runs
   every constructor invariant and repairs precisely what the test exists to catch. With a
   mapper-bug injection in place, the laundering form passed 9/9 with `"  Ada@Example.COM "`
   sitting in the emitted payload.

And the rule that outranks all five: **a deps obligation must be asserted, not documented.**
Corollary, applied twice: an obligation that *cannot* be asserted should not exist — Task 6
dropped `seededSessionCreatedAtAsGiven` after failing to construct any case it catches,
because an unassertable seeding burden on three future hosts, for no detection, is a cost
with no return.

**The tautology rule, stated after it was measured twice:** anywhere a driver's expectation
and the implementation's answer derive from a common source, the assertion is a tautology.
The backend's `beginIn` returns a `Session` built from its own arguments, and the driver read
the promised session from the same row, so both sides moved together and twenty tests sat on
top of the fault their own comment claimed to catch. Carried forward into Task 15 as a
warning rather than as history — and the counterfactual there reproduced the backend's
failure at the **same count for the same reason**, in a different framework and a different
codebase.

**Rejection-reason precedence is asserted, not documented**, and its purpose is written into
the enum's TSDoc. The purpose is not "the recorded reason must be true" — for a blocked and
unverified account, three reasons are all factually true. It is that **the recorded reason
must not imply a remedy that would not work**: `EMAIL_NOT_VERIFIED` for a suspended account
implies "verify your address and you are in", which is false. An order with a stated purpose
survives; an arbitrary-looking order gets simplified by the next reader.

**`ACCOUNT_DELETED` over `ACCOUNT_SUSPENDED` is left unasserted**, on that same reasoning:
both point at "an administrator must act", so misordering them changes which administrative
fact is surfaced, not the actionable category. *Cost to close later: one seeded account and
about four lines, already priced.*

**Registration is enumeration-safe beyond what the spec requires.** The existing-account
branch sends a different email and returns the identical response; the unique-violation race
answers the same way rather than surfacing a 409. The server knows which happened; the caller
does not. This is also why a new `AuditAction` member was added rather than reusing
`EMAIL_VERIFICATION_REQUESTED` — see §3 #27.

**`clientAddress`/`clientLabel`, not `ip`/`userAgent`** (a departure from the spec, recorded
so it can be overruled). Core may not name a transport concept, and "IP address" and "user
agent" are HTTP's vocabulary, not the domain's. What the domain knows is *something about
where the client was* and *something the client said about itself* — both nullable, both
possibly absent, neither meaningful to validate. *Cost if wrong: two field names, renamed in
one entity, one migration and three mappers.*

**`UNDISCLOSED` is a member of `AuthenticationRejectionReason`.** See §1. The plan already
requires every switch over that union to end in `assertNever`, so adding a member is a
compile error for every consumer — that forcing function is the point.

**`BREACHED` was added to `PasswordPolicyViolation`, and the registry is consulted on reset
and change as well as at registration.** A password refused at sign-up and accepted during
recovery makes the control decorative on the path that matters most, since the likeliest
reason someone is resetting is that they believe their credential is compromised. Same shape
as the foreign key: a guarantee that holds on one path and not its sibling.

**`WeakPasswordError.violations` reaches the response.** Core's own documentation says the
violation list is what a caller shows the person, and the exception filter was dropping it —
which made `BREACHED` tell nobody anything. It is a top-level key, present only on that
error and absent otherwise, so a client never has to tell `[]` from "not applicable".
Nothing in it is sensitive: it describes the password just typed, not anything about an
account, so D7 is untouched — and D7's whole-response comparison proved that structurally
rather than by anyone remembering to check.

### Tooling and gates

**The sanitize gate was narrowed four times, never weakened, and three of the four were
their own interstitial change.** The rule that emerged: when a feature task contorts code to
satisfy the gate, that is the signal — characterise the class precisely with two independent
agents, fix it in its own commit, verify adversarially, then revert what was contorted. The
decisive narrowing has a real argument behind it: **in TypeScript, a populated secret is a
quoted literal.** There is no such thing as an unquoted string literal in TS, so requiring
quotes loses nothing real; non-TypeScript files keep the old behaviour, where unquoted values
genuinely are literal. The whole-tree findings diff before and after was **identical** — 247
files, 40,349 lines, one finding.

Three things that were *not* fixed, deliberately, each with evidence rather than preference:
a suffix-tolerant key (it false-positives on the `*_POLICY` / `*_ACCOUNT` / `*_TTL`
vocabulary the backend was about to write a great deal of); a hard-coded `token=abc` in a URL
(widening produced a new finding on a legitimate fixture and broke seven pinned tests); and
a `.vue` template binding quoted by HTML syntax (distinguishing script from template needs
per-file structure, and building that "would repeat the restructuring pattern this task
exists to stop"). A documented gap beats a noisy gate — the cries-wolf failure is the one
that gets a gate switched off, which costs more than the leaks it catches.

**`grep` here is a ugrep-backed shell function, and it is not the only way a check can pass
along one path and fail along another.** Four instances this phase: raw versus rendered
markdown (`\|` in a table cell is a literal pipe under `-E`); ugrep versus system grep
(ugrep anchors a leading `$`, and — found in this close-out — silently fails to match a
bounded run either side of a required pair); jest colour under `nx` versus a bare `jest`,
which left the branch red at HEAD while every report said green; and `nx` replaying a cached
success, so a restored tree "passes" a gate that never ran. The standing rule: **when a gate
has a CI invocation, run that invocation** (`npx nx run-many … --skip-nx-cache`), and run
evidence greps under `/usr/bin/grep`, saying which.

**A signal that is a grep is replaced by a program when the grep cannot see its subject.**
W1 was inert; its replacement, `check-atomic-layers.mjs`, resolves every rendered PascalCase
tag to its defining layer, refuses imports from `~/pages` and `~/layouts` by path as well as
by tag name (a tag-name rule is evaded by renaming the import), and **fails when it is
pointed at nothing**. That last property is the whole point and it survived a later rewrite.

**The generated-project gate installs with `npm ci`.** See §2 — `npm install` was erasing
the signal it should have raised.

**The gate now reports which Node produced its result** (added in this close-out). It warns
on a version mismatch and fails on a missing or unreadable `engines.node`, reading the range
from the generated project rather than restating it. The asymmetry is the decision: a hard
failure on the mismatch makes the gate unrunnable for every developer whose Node has moved
on, and a gate nobody can run is a gate that gets deleted — while what is at risk is the
conclusion drawn from the run, which a warning corrects. A comparison against an *absent*
declaration must never read as agreement, so that half is fatal.

**Extraction sweeps need a shape pass, not only a word pass.** A word list finds `event` and
`ticket` and finds nothing at all in `https://someone.example`. A personal domain reached the
template inside a story's `to` prop, inherited verbatim from a source file where every
sibling used `example.com`, and neither the implementer's word sweep nor the brief's word
list could have found it — it is not a domain concept, it is a personal identifier. Spec §12
gained a step 5 that extracts every URL and email and checks them against an RFC 2606/6761
accept-list. Its first version was **case-sensitive on both the TLD and the scheme**, so
`HTTPS://Personal.COM/blog` was invisible — meaning the fix written for that finding would not
have caught that finding in upper case.

### Process

**Implementers commit at checkpoints and write their reports incrementally.** Adopted after
the second of three stalls. All three happened to an agent mid-verification with everything
uncommitted, and all three cost nothing only because the harness kills a stream without
rolling back the filesystem. Committing early converts a stall from a loss into a resume; it
recovered two of them. A checkpoint commit whose message says plainly what has and has not
been verified is not a false claim.

**The controller sweeps for orphaned containers after any stall.** "Remove what you create"
cannot be honoured by an agent that dies mid-run — one stalled reviewer left a Postgres
running for seven hours.

**`docker system df` is not the headroom number.** Read
`docker run --rm alpine df -h /` — alpine because it is 8.66 MB and declares no `VOLUME`.
`docker system df` once showed a healthy-looking 16.83 GB of images while the actual VM had
2.1 GB free, and running out is what crashed an unrelated live Postgres mid-transaction.
Build one image at a time, remove it before the next, and **stop and report below ~3 GB free
rather than reclaiming more** — the reclaimable space usually belongs to somebody else.

**Minors are ledgered, not looped.** Important and Critical findings open a fix round;
minors are recorded and triaged at the end. The exception is a minor that sits in a file
another task is copying from *right now*, which is fixed immediately.

---

## 6. For Mattia: the SSR payload

**This is a decision to ratify, not to inherit.** It ships to every generated project.

**What happens.** `app/plugins/auth-init.server.ts` renews the session once per
server-rendered request, so a signed-in visitor's first paint is already authenticated and
there is no signed-out flash. The auth store holds the access credential, and the store's
state travels to the browser in the SSR payload — so **the access token is in the HTML**,
for its 15-minute lifetime.

**The mitigation, and exactly what it does not cover.**
`cache-control: private, no-store` is set on any response that carries one, and there is an
assertion that fails without it. It closes shared and intermediary caches, which is the
serious path. It does **not** close:

- a response body captured by request logging or an APM agent,
- a page saved to disk,
- the browser's back-forward cache,
- a DOM-capturing error reporter.

That is the artifact-persistence class the store's own "in memory, nowhere else" rule exists
to avoid, so the payload is a deliberate partial exception to that rule rather than a case it
covers. It does **not** worsen XSS: script that can read the payload can read the hydrated
store and call the renewal endpoint anyway.

**What the alternative costs.** Seeding only `status` and the user, and letting the client
renew on hydration, does avoid the flash — the three-state `status` prevents it, not the
token. But it is **not** "one line in the store", which is what the first report claimed and
what nearly decided this the other way. With no credential client-side, `createAuthFetch`
finds `presented() === null` on the hydration 401 and rethrows **without** renewing — which
is the same task's own fix for the bug that signed a visitor out for a mistyped password. So
the alternative needs a whole `auth-init.client.ts`, a second rotation on every page load,
and a second place the renewal race has to be right. An inaccurate cost estimate on a
security trade is worse than no estimate.

**The current position** is: keep the design, and make both claims about it honest — which
has been done, in the store's own TSDoc and in the plugin's comment. Overrule it by deleting
the credential from the seeded state and adding the client plugin.

---

## 7. Documented, not fixed

Each of these is real, each was considered, and each is here rather than in the code for a
stated reason.

| | Why it is not fixed |
|---|---|
| **`BREACHED` is pinned by no conformance assertion** — zero occurrences in any suite | It cannot be pinned while the shipped registry is a no-op that returns `false` unconditionally. Flagged by the agent best placed to know, explicitly so this close-out would not claim otherwise. **It does not claim otherwise.** |
| **A revoked session leaves its access credential valid for up to 900 seconds** | `jwt.strategy.ts` reads nothing from the database; that is what "stateless access credential" means. The walk asserts what is actually falsifiable instead — the sessions list is empty, the successor cookie is dead, the old password is refused. Shortening the TTL or adding a revocation check is a real design change with a real cost, not a fix. |
| **`audit_entries` grows without bound, and the application cannot prune it** | `DELETE` is revoked, by design. Retention against an append-only table is a design question — partitioning, a retention role, time-bounded partitions dropped by the owner — and belongs to Phase 3, not to a fix wave. |
| **`FakeDataSource`'s nine documented limits** | An explicit numbered inventory on the class, with audit immutability flagged as the most load-bearing: the fake happily `UPDATE`s and `DELETE`s an audit row, so any assertion leaning on immutability cannot fail against it. Building the missing capabilities was explicitly refused; several are only provable against a real database, and Task 19's walk owns the four that matter. **A fake that is *wrong* is worse than one that is *limited*,** which is why concurrent same-key rollback was fixed and the rest were documented. |
| **Nothing ties the webapp's fetcher paths to the backend's routes** | All fifteen were checked by hand and match; a typo is caught by no gate. The wire *vocabulary* does have a cross-check in both directions, added after renaming a code in three webapp files left 96/96 green while the backend still emitted the old one. Paths would need the same treatment. |
| **W2 is a grep, not a gate** | Unlike W1, which became `check-atomic-layers.mjs`. W2's subject (a component calling a fetcher directly) does exist in the tree it scans, so the grep is live rather than inert — it is just manual. |
| **Storybook's build fails, root cause unknown** | `EXIT=1`, `✓ 0 modules transformed`, `[vite:build-html] Missing field 'moduleType'`. **Reproduced this phase** by Task 17's reviewer — an earlier note in this project's ledger saying nobody had reproduced it is superseded. Dependency drift was the standing hypothesis and it has been **tested and falsified**, twice, including an install pinned to the exact versions believed to be the known-good combination. Two things in this environment are *not* evidence: a shell `command_not_found_handler` can return **`EXIT=0`** with a one-line log and no output directory, and a failed run still leaves `storybook-static/` behind. Forge's own CI job stays `continue-on-error: true` with an accurate comment. |
| **A cold `FORGE_E2E=1` run now builds four images** | The dev stack is two, the production smoke check added two more. **Headroom is the binding constraint on that gate** — the tightest point this phase was 3.3 GB free, and the implementer stopped rather than push past ~3 GB, which is the instruction working. An operational fact about the suite, not a defect. |
| **`libs/core`'s `{@link}` targets do not all resolve** | Swept for this close-out: 59 targets, **26 unresolvable, and the pattern is uniform across all four domains**. Thirteen cannot be made to resolve at all — the entity imports the props type, so the import that would resolve `{@link Session}` in `SessionProps.ts` is a cycle. Fixing only the importable half is the one way to produce the two conflicting precedents the original ruling existed to avoid. Now a stated rule in core's `STANDARDS.md`. |
| **`ApiErrorCode` exists in two places** | Acceptable *because* the cross-check exists. The defect was never the duplication, it was the missing agreement. |

---

## 8. Out of Phase 2, named so they are not lost

- **`tools/sanitize.mjs` bans `invitations?` outright**, while spec §9.4 makes organization
  invitations a first-class Phase 3 concept. Phase 2 never needed the word. The likely
  resolution is to narrow the rule to the source project's compounds rather than the bare
  noun — the same treatment `event`, `payment` and `ticket` already get, for the same reason.
- **ADR-0006's actual rule — the server enforces authorization on every route whether or not
  a client asks — is cited by no review dimension in any package.** Phase 3 ships `can()`
  behind a guard and owes it a row.
- **`AuditQuery.organizationId` and `UserQuery.search` are deliberately unpinned.** No world
  can hold two tenants until Phase 3, and `search`'s semantics need a persistence-backed
  implementation to force the question.
- **Audit retention**, per the `audit_entries` row in §7.
- **D9 (tenant isolation), D12 (grant revocation) and D15 (last owner)** need organizations —
  Phase 3. **D11** (OAuth email-match linking) needs Phase 4. **D10** (MFA challenge) needs
  Phase 5.
- **A minor operational note discovered in this close-out:** `docker run -d --rm` followed by
  `docker rm -f` leaves the container's anonymous volume behind — reproduced twice, and the
  likely mechanism for a stray volume Task 19 noticed and could not attribute. Foreground
  `docker run --rm` does not leak.

---

## 9. The triage

Thirty-two parked items, sorted by the Phase 1 test: **does this affect a real user of a
generated project?** **Eleven fixed, twelve left documented with a reason, six named as out
of phase, and three found already discharged** by a later task that had not recorded closing
them. The full table with evidence is in
`.superpowers/sdd/2026-09-18-forge-phase-2-identity-foundation/task-20-report.md`; the
substantive outcomes are §7 and §8 above, plus:

- **One password identity per user was enforced by nothing** — a second `PASSWORD` row for
  one account inserted fine, while `findPasswordIdentityByUser` is a `findOne` assuming
  otherwise. Fixed with a **partial** unique index on `(user_id) WHERE provider =
  'PASSWORD'`, which raises the same `23505` so the registration race is unaffected, and
  still allows GOOGLE and GITHUB — and a *second* GITHUB — on one account. A table-level
  `UNIQUE (user_id, provider)` would have been a different rule wearing the same name.
- **Two shipped agent prompts and four shipped documents had become false**, mostly because
  the task that built the user-facing surface did not revisit the files saying it did not
  exist. `backend-tester.md` told the agent to add `supertest`, which has been a
  devDependency since Task 11 and which five specs already import — and adding it again
  desyncs the lockfile the gate now refuses. Task 18 re-derived Forge's own README claim by
  claim and found seven stale ones; it did not look at the docs the *template* ships, and
  those had drifted further.
