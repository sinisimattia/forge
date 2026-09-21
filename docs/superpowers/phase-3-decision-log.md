# Phase 3 — Decision Log

The rulings made while building Forge's Phase 3 — organizations and authorization —
preserved from the execution ledger so they survive it. Each records what was decided, why,
and what it costs if the decision was wrong.

Read this before reversing anything here. Most of these look like taste and are not: they
were made after a specific failure was observed, reproduced, and usually measured.

Its companions are `phase-1-decision-log.md` and `phase-2-decision-log.md`. Phase 1's
most-used section was its list of places the plan was wrong; Phase 2's was longer; this
one's is [§3](#3-where-the-plan-was-wrong-and-testing-found-it), and the plan it describes
is mine.

**The phase's own signature defect is different from Phase 2's, and worth naming at the
top.** Phase 2's was *a check that passes because it never ran*. Phase 3's is **prose that
asserts something the code does not do** — five instances, in comments and TSDoc that
survive every gate this project owns because no gate reads prose. Four of the five were
believed by a later reader before anybody checked. They are listed in
[the five](#the-five-worth-knowing-before-you-touch-the-code), item 2, by file and line.

---

## The five worth knowing before you touch the code

1. **The generated application did not boot, and the only gate that could tell you was the
   one nobody was running.** `AuditModule` registered no `OrganizationRecord`, and a guard
   is instantiated in the module context of the controller that names it — so
   `PermissionsGuard`'s `Repository<OrganizationRecord>` could not be resolved and
   `AppModule` threw `UnknownDependenciesException` at start-up. **Every fast tier was
   green while this was true, all phase**, because `generated-project` and `docker` were
   `if: pull_request` and the branch was being pushed to. Promoting them to run on push
   (Task 20) caught it on the first run. The fix is two things: the missing registration,
   and `apps/backend/src/__tests__/guard-wiring.spec.ts`, which catches the whole class in
   1.3 s. That spec **discovers** guards from `@UseGuards` metadata rather than reading a
   hardcoded list — a list can go stale silently; discovery cannot — and a reviewer proved
   the distinction by writing a brand-new `ProbeThirdGuard`, mentioned nowhere in the spec,
   wiring it onto a controller in a module that does not register its repository, and
   watching discovery find it unprompted. This is Phase 2's `nest-cli.json` lesson in a new
   place: *a green fast tier says nothing about whether the thing boots.*

2. **Five comments asserted something the code did not do.** Same class as an assertion
   that cannot fail — the artifact reads as authoritative and is not — and, as Task 8's
   reviewer put it, *"no test or gate catches prose correctness, so this shipped clean
   through every gate."*

   | # | Where | What it claimed | What was true |
   |---|---|---|---|
   | 1 | `libs/core/.../Permission.ts:17` | layer three "arrives next" | it had just landed. The task report also claimed both comments were updated when `Permission.ts` was absent from the diff entirely |
   | 2 | `apps/backend/src/audit/audit.service.ts:141-144` | the tenant filter's semantics "are not pinned by the conformance suite", **and instructed** the reader to add an assertion first | the same task had just pinned them. A reader either duplicates an assertion that exists or treats a pinned contract as changeable |
   | 3 | `mail/templates/organization-invitation.ts:22-25` | the mail carries the token "in a path segment" | the code builds `?token=` |
   | 4 | `apps/backend/src/__tests__/tenant-isolation.spec.ts:665` | `migration-sql.spec.ts` "asserts the `ON DELETE SET NULL` clauses themselves" | it asserted one, for `refresh_tokens`, from Phase 2. The three Phase 3 clauses were asserted **nowhere** |
   | 5 | `libs/core/.../Organization.ts:20-31` | the slug "ends up in `/organizations/<slug>` and in mail links" | neither. Routes are `[organizationId]`; the invitation mail carries `?token=`. The slug's entire validation rule was left true but unjustified |

   Two of the fixes are the ones to copy. #4 was fixed by **adding the three missing
   assertions** rather than softening the sentence, so the comment became *true* instead of
   merely accurate — an incorrect pointer to coverage is worse than an acknowledged gap,
   because it stops the next person looking. And the replacement comment records that the
   tests exist *because it first claimed they did*. #5's replacement is self-enforcing: it
   states the slug is "not currently used in any URL", then that "it is *reserved* for that
   use, not put to it yet", then "Say it that way and no other."

3. **Enumerating the bad inputs does not converge. Refuse everything you do not model.**
   `migration-sql.spec.ts` guards the append-only audit table statically. It took **five
   fix rounds, each closing exactly one syntactic spelling of a table reference and each
   followed by another**: quoted identifier → schema-qualified → a `CREATE TABLE` composed
   behind a `COMMENT ON` → `IF NOT EXISTS` → dollar-quoting → `E'…'` escape strings and an
   identifier-adjacent `$`. Round four replaced the regexes with a normalizer and
   immediately found three live holes no further round of token-adding would have reached
   — including a statement extractor that read only two of the three string delimiters, so
   anything written with the third was **invisible to every guard in the file**. The fix
   that finally held (Task 22a) is the opposite move: `canonicalize` **lost its default
   case** in favour of a token-start whitelist that refuses the whole argument on anything
   unmodelled, and the `QueryRunner` escape hatch was closed by an **allow-list of one
   method** rather than a deny-list of dangerous ones — "enumerating the dangerous members
   is the move that failed five times." See [§2](#2-the-measurements) for the test count
   over those rounds.

   **Then the trap, which is the sharpest thing the phase produced.** The extractor read
   raw TypeScript source, so `queryRunner.query('COMMENT ON TABLE t IS \'x\'')` — valid
   SQL, lint-clean, and *this codebase's own quote style* — arrived with its backslashes
   intact and was refused as "the character `\`". The obvious one-character remedy is
   adding `\` to `MODELLED_PUNCTUATION`, and the file's own TSDoc says that line "is what
   makes `E'\''` unreachable by a second route". **The guard's failure message pointed an
   author directly at the change that reopens the hole it exists to close, and nothing
   disclosed it.** That is worse than an over-broad refusal, because the remediation is both
   obvious and catastrophic. Fixed by decoding a *closed list* of TypeScript escapes in the
   extractor (three quote forms, `\\`, `\n\r\t`; everything else left verbatim so the lexer
   still refuses) — and the outcome that matters is that applying the tempting fix now reds
   12 tests instead of silently working.

4. **D9's natural fault is fail-closed, so the test had to be rebuilt against the fault that
   can actually leak.** My R3 design ruling said a guard hydrating the principal from
   `request.params.id` was a cross-tenant leak. It is not: it looks a *user* up by an
   *organization* id, finds nobody, and refuses everything. The original test only
   discriminated because the implementer had seeded an **id-collision fixture** — a user row
   whose id equalled `ORG_B`. The fault that can actually leak is different: *the guard
   passes correctly for the organization the route names, and then the service resolves its
   target row by id alone, with no `organization_id` in the predicate.* The injection was
   rebuilt against that shape (drop `organizationId` from `requireInvitation`), and the
   result is a demonstrated cross-tenant **write**, not an inference: tenant B's invitation
   goes `PENDING → REVOKED` from a request made wholly inside tenant A as A's owner. The
   original fault was kept and **recorded as fail-closed with the measurement that proves
   it — 14 red, every one a control, zero refusal assertions among them.** That is how to
   show a fault is fail-closed: not by arguing it, but by showing that only the controls
   break.

5. **D12 has no route to test against, and ships as a labelled partial plus a tripwire.**
   `can()`'s layer three consults grants only when the caller passes `resourceType` *and*
   `resourceId`, and **no call site in the backend passes either.** That exclusion is
   correct and stays — naming the organization itself as the record would make an
   organization admin's `grant:create` a route to `organization:delete`, the same escalation
   that made `platform:administer` excluded from layer three. But the consequence is that
   grants are hydrated, expiry-filtered, served on `GET /users/me/principal` and **consumed
   by nothing**, so "a grant revoked mid-session, next request denied" cannot be exercised
   end to end. It ships as a `PrincipalService`-level partial carrying a 23-line TSDoc that
   says plainly *"D12 is NOT satisfied by this suite"* — plus a **tripwire**: an assertion
   that no `can()` call site names a record, so the day one does, D12 goes red as owed.
   *"Making layer three fire means designing a production guard mechanism, not writing a
   test."* Converting "not testable yet" into "will announce itself the moment it becomes
   testable" is strictly better than a note in a document nobody re-reads.

---

## 1. The formulations that earned their place

Quoted verbatim, attributed to the round that produced them, because each one changed how a
later task worked.

> **"That argument doesn't distinguish this case."**
> — Task 9, fix round 2, on being told a bypass was unlikely because "TypeORM doesn't write
> it". In full: *"'TypeORM doesn't write it' applies equally to every other fault this file
> catches — that argument doesn't distinguish this case."* It is the general test for a
> likelihood argument offered in place of a fix: if the same argument would excuse every
> other rule in the same file, it excuses none of them. The implementer then went past what
> it had been asked and fixed **both** divergent guards together, because the root cause was
> two guards over one table disagreeing about that table's accepted spellings.

> **"Enumerating the dangerous members is the move that failed five times."**
> — Task 22a, on closing the `QueryRunner` escape hatch with an allow-list of one method
> rather than a deny-list of dangerous ones. The phase's central lesson, generalised
> correctly rather than repeated locally: the same task's other half made `canonicalize`
> lose its default case in favour of a token-start whitelist, for the same reason.

> **"No test or gate catches prose correctness, so this shipped clean through every gate."**
> — Task 8's reviewer, on a comment that instructed readers to add an assertion the same
> commit had already added. It names the phase's signature defect, and it is why five
> comment corrections are the second item in the list above rather than filed as chores.

> **"Making layer three fire means designing a production guard mechanism, not writing a
> test."**
> — Task 20, refusing to manufacture a passing D12. The corollary it shipped instead is the
> part worth copying: a **tripwire** that reds the day the gap closes, which converts "not
> testable yet" into "will announce itself the moment it becomes testable".

> **"It changes only when somebody alters this table — which is precisely when a reviewer
> must look — so the maintenance cost IS the guard working."**
> — Task 9's reviewer, on an allow-list that has to be edited by hand whenever
> `audit_entries` legitimately changes. The friction is the feature; a guard that never
> needs attention is usually a guard that is not watching anything.

> **A rule nothing can break is not a rule, and deleting it is better than keeping it as
> decoration.**
> — Task 22a, which mutation-tested all six of its refusal rules, found a **seventh that
> survived every mutation**, and removed it rather than leaving it in as apparent coverage.
> The construct it named is still named — as a case, with the explanation of why another
> branch already refuses it. Applying the phase's own thesis to its own work, unprompted.

---

## 2. The measurements

These are what make the argument rather than decorate it. Figures carry the commit they
were taken at.

### The audit mapper: the field that stopped being null

Phase 2's final review left a standing finding — `runIAuditServiceContract` compares ten
wire fields and three of them were `null === null` on the backend driver. Phase 3 is
tenancy, so `organizationId` is exactly the field that stops being null. Task 8 was
dispatched to measure it before and after:

| | |
|---|---|
| dropping `organizationId` from `AuditService.toEntity`, **before** (at `0e677ee`) | **499/499 green** — the prior phase's finding reproduced exactly |
| the same drop, **after** (at `2203f99`) | **2 failed / 502** — the wire-shape test *and* the new `organizationId` filter test |
| `clientAddress` / `clientLabel`, independently re-checked | now fail the wire-shape test too, which is precisely the gap the roadmap recorded (they previously failed only a *different* test while the wire-shape test stayed green) |

Three of ten compared fields were assertions about nothing. They are now assertions about
something.

### The sharpest result in the phase: a status-only suite passes an implementation whose body leaks

At `a8c7de4`, injecting a `404` with a **different `code`** for a cross-tenant invitation
turns the body comparison red **while all five status-comparing rows stay green**. That is
direct, measured proof that a suite comparing statuses alone would pass an implementation
that leaks in the body — which is the entire reason the tenant-isolation comparisons assert
raw bodies. The end-to-end walk (Task 21) does the same at the transport level:
`assert.equal(crossTenant.text, noSuchOrg.text)` on **raw body text**, not re-serialized
JSON, against `PermissionsGuard`'s bare `NotFoundException` at all four refusal sites.

Measured alongside it, and worth keeping: five refusal paths are **byte-identical** at
`404 {"error":"Not Found","message":"The requested resource was not found"}` — a member of
A asking about org B, anyone asking about an absent id, a member of their own org without
the permission, an outsider, and an unmounted path.

### The discriminating tests

| Test | Injection | Result |
|---|---|---|
| **D9** | drop `organizationId` from `requireInvitation` | **2 red**, including tenant B's invitation moving `PENDING → REVOKED` from a request made wholly as tenant A's owner — a demonstrated cross-tenant write |
| **D9 (the fail-closed fault)** | hydrate the principal from `request.params.id` | **14 red, every one a control**, zero refusal assertions. The fault is total refusal, not a leak |
| **D12** | a `Map` cache in front of the hydrator | 5 red including the labelled partial; the tripwire trips when a `can()` call site names a record |
| **D15** | `targetUserId === actorId` in place of the last-owner check | **exactly 4 red**, and the opposite injection (delete the owner-count check) reds 6 while "two owners, either may go" stays green — so the suite discriminates *refuse-nothing* from *refuse-everything* in both directions |

### What the wiring assertions were worth

| | |
|---|---|
| deleting `@UseGuards` from any of the three invitations routes (at `01af1eb`) | **all 774 green**, and the escalation is real: `ROLE_PERMISSIONS` gives `MEMBER` only `organization:read` + `member:read`, while the service checked *membership alone* — so any member or viewer could invite, list and revoke |
| after the fix (`5987846`) | each of the three deletions reds **exactly and only its own case**, and each new case is paired with an `ADMIN` control so none can be satisfied by a guard that refuses everybody |
| making the guard refuse unconditionally | **33 red, including the ADMIN controls** — which is what proves the controls discriminate |
| `guard-wiring.spec.ts` anti-vacuity (at `7a7551f`) | renaming the `GUARDS` metadata key produces a **hard** failure: the `declarations.length` assertion reds (`Expected > 1, Received 0`) *and* jest throws `.each called with an empty Array of table data`. No path made it pass vacuously |

### Layer three's non-authoritativeness, and a test whose name claimed the wrong property

At `037c1ec`, changing `if (granted) return true;` to `return granted;` passes **406/406**
— and it is not an equivalent mutation. `can(member, 'user:read', {organizationId, ownerId:
self, resourceType, resourceId})` is `true` shipped and `false` mutated, because no role
carries `user:read`, so layer two never short-circuits and the switch's ownership rule is
what answers. Mutated, layer three silently *revokes* that rule for any resource naming both
an owner and a record.

**The sting:** the existing assertion named *"does not take away what the role already
allowed"* **cannot fail against it**, because layer two returns `true` before layer three
runs. It pins **ordering**, not **additivity** — a test whose name claims one property while
exercising another. The fix added the assertion that actually pins additivity (red alone at
1 of 407) and corrected the old test's comment rather than deleting it.

### `migration-sql.spec.ts` across seven rounds

| At | Tests | What changed |
|---|---|---|
| before the migration existed | 43 + 1 red | — |
| `9f02781` | 48 | the Phase 3 migration's own assertions |
| `a041740` | 49 | three rounds of per-spelling patching (quoted, schema-qualified, composed `CREATE`) |
| `e902b49` | **139** | the normalizer. 23/23 injected offenders refused; every normalizer rule pinned by a test that fails without it; all six guards go red, not green, on an empty corpus |
| `d1976e3` | 160 | the dollar-quote lexer branch, plus a pre-existing `U&"\0061udit_entries"` hole refused **wholesale** rather than decoded (UESCAPE can redefine the escape character; decoding would mean writing a parser) |
| `78aff33` | 168 | the three `ON DELETE SET NULL` clauses §1 item 2 #4 claimed were asserted |
| `7338f5d` | 208 | fail-closed whitelist; **all six refusal rules mutation-tested, and a seventh that survived was removed as unfalsifiable** |
| `9dc256f` | **229** | the escape decoder. Applying the tempting `\`-to-`MODELLED_PUNCTUATION` fix now **reds 12 of 229** |

The row that matters most is the seventh: the implementer applied this phase's own thesis to
its own work, unprompted — *a rule nothing can break is not a rule, and deleting it is
better than keeping it as decoration.*

### The SSR credential, discharged

Phase 2's §6 ruling, measured at `7824d08` against the shipped server plugin, the real
`pinia.state.value` and real `devalue`:

| | |
|---|---|
| **before** | `{auth:{accessToken:"minted-by-the-server-000-LOOK-FOR-ME",user:{…},status:"authenticated"}}` — credential in payload: **true** |
| **after** | `{auth:{user:{…},status:"authenticated"}}` — credential in payload: **false** |

`status:"authenticated"` still crosses, which *is* the no-flash guarantee, and
`private, no-store` stays because the markup still names a person.

### Suite sizes and the end-to-end walk

| | At `9dc256f` |
|---|---|
| `libs/core` | **424** (coverage 100/100/100/100) |
| `apps/backend` | **1006** (from 499 at the start of the phase) |
| `apps/webapp` | **365** (from 255) |
| Forge's own unit tier | **88** |
| Forge integration, `FORGE_E2E=1` | **22 pass / 0 skip**, 181.2 s — 94.4 s tenancy walk, 86.6 s production-image smoke |

The two previously-skipped `FORGE_E2E` tests both ran and passed for the first time.

### Other measurements worth keeping

- **`FakeDataSource` enforces no unique constraints**, so `uq_memberships_org_user`,
  `uq_organizations_slug` and `uq_organization_invitations_token_hash` are unexercised by
  the whole fast tier. This is why Task 12's double-accept defect — admin invites twice,
  recipient clicks both, second insert violates the unique constraint and maps to a **bare
  500 with no code** — was invisible: sequential, no concurrency needed, and the fast tier
  cannot see it by construction.
- **Every `node@20`…`node@26` opt-symlink on this machine aliases the same Node 26.5.0
  keg.** There is no real Node 22 here, so installing it by the obvious route does not give
  you it. `template/package.json` declares `>=22 <23` and both Dockerfiles pin 22 — so the
  Docker walk is the **only** place in this phase where anything ran on the declared Node,
  and it ran inside the images rather than on the host.
- **`node --test tests/integration/` (bare directory) does not resolve on this host**;
  `node --test tests/integration/*.mjs` discovers the same three files. My command was
  wrong, not the implementer's substitution.
- **Docker headroom was 4.2 GB, not the 8.6 GB I recorded at dispatch** — corrected by a
  reviewer; reclaiming our own build cache brought it back to 8.6 GB. Phase 2's rule still
  holds: read `docker run --rm alpine df -h /`, stop below ~3 GB, and the reclaimable space
  usually belongs to somebody else.
- **The gate-list pinning test failed on its first run, on real drift**: `coverage` was
  present in `ci.yml` and in neither the root `affected` list nor `nx.json`. It found a live
  gap the moment it existed, and was fixed in the right direction — `coverage` added to the
  two weaker lists, not trimmed from the strong one.
- **A load-sensitive flake, two sightings, two files, same shape**:
  `invitations.controller.spec.ts` (Task 15) and `members.controller.spec.ts` (Task 18).
  Both are backend *controller* specs, which suggests a shared cause rather than one bad
  test. Neither reproduced on retry — capped at 2 runs, deliberately, for the reason in
  [§4](#4-my-own-claims-corrected).

---

## 3. Where the plan was wrong, and testing found it

Phase 1's log says this is its most valuable section, and Phase 2 agreed. This phase's plan
was wrong in **twenty-two** recorded ways. The pattern is more useful than any one row, and
it is not the same pattern as Phase 2's: where Phase 2's defects were mostly *stale facts*
and *unfailable assertions*, most of these are **a plan written against a codebase the
planner had not read closely enough** — conventions, runners and file layouts that were
already documented and already contradicted.

| # | Task | What the plan or brief said | What was found |
|---|---|---|---|
| 1 | 3–7 (P1) | write seven spec files under `libs/core/src/**/__tests__/`, verified with `npx vitest` | core runs **jest**, `testMatch: ['<rootDir>/tests/**/*.spec.ts']`. Specs under `src/` would never have executed and six `vitest` commands do not apply. `template/libs/core/CLAUDE.md` already said so, so the plan contradicted a doc that ships to every generated project |
| 2 | all (P6) | twenty-three gate commands run inside `template/` | **no gate can run inside `template/`.** Its `package.json` is `"name": "__FORGE_NAME__"` — unsubstituted by design — so `npm install` fails and `npx nx` has nothing to run. Two tasks independently worked around it before it was ruled on |
| 3 | 2 (P2) | inject an `AuthenticationStatus` enum member to prove the exhaustiveness forcing function | `AuthenticationOutcome` is a discriminated union whose variants pin `status` to specific members, so a bare enum member adds no variant and `assertNever` still receives `never`. **The injection fails nothing, anywhere.** The valid form adds a member *and* a matching variant |
| 4 | 2 (P3) | `assertNever(outcome.status)` | does not compile — switch narrowing makes `outcome` itself `never`, so the property access errors. `assertNever(outcome)` is what core and backend already use |
| 5 | 2 (P4) | add a `coverage` target to `libs/core/project.json` | one already existed. The only real gap was that no CI invoked it |
| 6 | 3 (P5) | give core errors a `code` property | **no error in core has one.** `DomainError` sets `this.name = new.target.name` and the class name *is* the identifier. The `code` I had in mind is the backend's HTTP envelope field, produced by the exception filter from the error class |
| 7 | 6 (P9) | a new `Permission` member must fail typecheck in core, backend **and** webapp | core ❌, backend ❌, **webapp ✅** — and that is correct, not a regression. Nothing in the webapp enumerated `Permission`; it gains its first consumer only in Task 17. I had conflated two unions |
| 8 | 6, 9 (P10, P12) | `expect(value, message)` in spec snippets | that is vitest's two-argument form; **jest's `expect` takes one argument** (TS2554). Corrected in the Task 6 snippets and then repeated one task later in Task 9's |
| 9 | 9 (P12) | `statementsMatching` called with a bare `string[]` | it needs `[name, statement]` tuples. This is the vacuous-pass class the brief itself warns about, one step further in — **the warning named the right hazard and then demonstrated it** |
| 10 | 5 (P7) | assertion 14 issues the invitation to "an address that is nobody's account" and has `outsider` redeem it | redemption checks the address, so a **correct** implementation refuses and the assertion fails. Task 15's backend would have gone red for being right |
| 11 | 5 (P8) | assertion 8 compares against four members | three. The world seeds four users but one is `outsider`, who belongs to no organization by construction |
| 12 | 5 | the fifteen-row assertion table | omits `revokeInvitation` entirely, while the contract declares it — **a contract method with zero assertions** — and declares two deps nothing consumes |
| 13 | 15 (P13) | the D9 injection (`getOrganization` skips its membership check) will red the security suite while the shared suite stays green — the evidence that DEC-1's split works | **impossible.** `getOrganization` is a single `return toOrganizationEntity(await this.requireMember(...))`, so both assertions reach the same line; that injection is both faults at once and cannot demonstrate a split. The implementer reported the contradiction rather than the expectation and **constructed the injection that actually demonstrates the claim** (`requireInvitation` drops its `organizationId`): 3 red, all new, shared suite green |
| 14 | 6→7 (C1, P11) | Task 7 must update "`Principal` literals — its tests and `PlatformAdminGuard`" | **four** backend sites, not one: `platform-admin.guard.ts:96`, `audit.service.ts:115`, `users.service.ts:264` and `:282`, plus every literal in Task 6's two new spec files |
| 15 | 8 (C2) | re-type `AuditEntryProps.organizationId` in core; file list omits the backend mapper | a branded type does not accept the record's plain `string`, so the task's own typecheck step would have failed |
| 16 | 13→14 (C3) | the `@RequirePermission` annotation table | covers Tasks 10–12's routes only. Task 14 creates four more and is never told to annotate them — four authenticated-but-unauthorized endpoints |
| 17 | 16→17 (C4) | the webapp store holds a `Principal` "hydrated from an endpoint, never assembled client-side" | **no task builds that endpoint.** `GET /users/me/principal` was added to Task 13 |
| 18 | 10 (T10-b) | — | **none of the organizations domain errors were mapped in `HttpExceptionFilter`**, so `GET /organizations/:id` for a non-member answered 422 instead of 404 — leaking existence. The conformance suite cannot catch it: it asserts at the *service* level, and the HTTP mapping is a separate surface. The plan never mentions the filter table anywhere |
| 19 | 9 (T9-a) | the schema makes `invited_by_user_id` and `granted_by` nullable with `ON DELETE SET NULL` | core declared both **non-nullable**, and the mappers cast through it — unsound the moment a referenced user is hard-deleted. Widened in core across 17 sites, following `AuditEntry.actorId`'s existing precedent |
| 20 | 11 | "state the cost of `SERIALIZABLE`" | stating it is not handling it: no catch of `40001`, no filter mapping, no retry helper, so a real conflict was an unhandled 500 telling the caller nothing about the retry the comment said they must do. My under-specification |
| 21 | 13 (R3) | hydrating the principal from the route parameter is a cross-tenant leak | it is **fail-closed**. See [the five](#the-five-worth-knowing-before-you-touch-the-code) item 4 — this is my design ruling being wrong, not an implementer's miss |
| 22 | 21 | `node --test tests/integration/` | does not resolve on this host |

**What the pattern says.** Rows 1, 2, 4, 5, 6, 8 and 22 are all the same failure: *the plan
asserted a fact about the repository that the repository already contradicted, in a file
that was reachable.* Rows 3, 9, 10, 12 and 13 are the more dangerous kind — an injection, an
assertion or an expectation that **could not have produced the evidence it was written to
produce**, and would have shipped looking like proof. Row 13 is the one to remember: a
phase-defining claim was about to be "proved" by a result that could not distinguish it, and
what caught it was an implementer running the injection instead of reporting the
expectation.

---

## 4. My own claims, corrected

Beyond the twenty-two plan defects above, which are all mine. These are the ones about
process and about the phase's own record.

1. **My dispatch wording destroyed the system temp directory.** Every dispatch said
   `PROBE=$(mktemp -d)/probe` and then "delete the mktemp parent". `$PROBE`'s parent *is*
   the mktemp dir — but "the mktemp parent" reads just as naturally as one level above it,
   which is `$TMPDIR`. A Task 13 re-reviewer read it the second way and ran `rm -rf` against
   `$TMPDIR`. The sandbox refused the macOS-owned entries; what actually went was
   `node-compile-cache` (2.6 GB), `jest_dx` (396 MB) and the accumulated
   `nx-native-file-cache-*` directories — all regenerable, nothing else touched, repo clean,
   Voku unchanged. **The agent reported "only my own probe subdir was actually removed",
   which was inaccurate, and checking rather than relaying it is the only reason this record
   is right.** The corrected form, used for every dispatch since: name the directory you
   created in its own variable and delete *that*, never a computed ancestor.

   ```
   PROBE_ROOT=$(mktemp -d)
   PROBE="$PROBE_ROOT/probe"
   ...
   rm -rf "$PROBE_ROOT"        # the directory you created, never a path derived from it
   ```

2. **I killed a working review agent because four hours of silence is indistinguishable from
   death from outside.** The Task 15 reviewer ran 4 h with no report where every prior review
   took 3–8 minutes. State on disk was clean, which told me nothing was half-written, so I
   stopped it. Its dying line was *"Not reproduced in 8 clean runs. Let me check the timeout
   hypothesis directly."* **It was not stalled.** It was doing exactly what I asked —
   characterising a load-sensitive flake — by regenerating a probe and re-running the full
   872-test backend suite, over and over.

   The cause was my dispatch: *"what makes it load-sensitive, how often it fails, whether it
   is a real race or an artefact"* is an **unbounded empirical question**, and I attached it
   to a review that already carried five injections. A reviewer given "how often does it
   fail" with no budget will keep sampling, correctly, forever. The corrected rule: any
   reproduce-a-flake or measure-a-frequency request carries an explicit cap ("at most N
   runs; if not reproduced in N, say so and stop") and is never bundled with a large
   verification. The re-dispatched, budgeted review returned in **~5 minutes**.

   **The lesson that generalises past this phase:** the only thing that distinguished work
   from death was the agent's last line, and I could only see it *after* killing it. A
   long-running agent that does not report progress cannot be told apart from a dead one by
   its controller.

3. **I staged briefs in batches and lost count — twice.** `task-15-brief.md` and
   `task-18-brief.md` were never staged. Both implementers noticed, said so, and fell back
   to the plan's own task sections, which only worked because the plan is self-contained.
   Fixed systematically rather than one at a time — all 22 briefs staged and verified by
   count. I had no mechanism that would have caught an implementer that silently invented
   requirements from a file it could not read; neither of these did, and that is luck rather
   than design.
4. **`Permission` has 15 members, not 16**, and the plan's prose said "three to sixteen".
   Cosmetic, corrected, recorded because a count nobody can reproduce is worse than no
   count — Phase 2's lesson, repeated here at lower stakes.
5. **I recorded Docker headroom as 8.6 GB at Task 20's dispatch; it was 4.2 GB.** Corrected
   by the reviewer against `docker run --rm alpine df -h /`.
6. **"Task 12 is the first commit carrying invitation vocabulary"** — Task 8 was, via
   `INVITATION_ACCEPTED`. A prose slip in the plan, no instruction affected.
7. **My Voku instruction was over-broad** and would have suppressed the check it exists to
   satisfy. I wrote "do not run any git command inside it", so a Task 7 implementer
   correctly skipped `CLAUDE.md`'s own prescribed `status --porcelain` / `rev-parse HEAD`.
   Both are read-only and both are mandatory. Corrected wording for every remaining
   dispatch: *read-only verification there is expected and required; never run a mutating
   git command.* **The read-only check is the only thing that would catch an accidental
   write to the extraction source, and I had been instructing implementers not to run it.**

---

## 5. The rulings

### Authorization

**`grants` is a REQUIRED field on `Principal`, never optional.** An optional list lets a
hydrator omit it silently, and `can()` would read `undefined` as "no grants" rather than
failing. The whole point of R2 is that the hydrator is the only place expiry runs, so
forgetting it must be a compile error. *Cost if wrong: a larger mechanical diff in one task,
caught by its own typecheck either way.*

**`can()` keeps its hard `return false` for "no membership", and layer three never widens
past it.** Removing it and letting the code fall through left all 41 authorization tests
green — harmless *then*, because every organization-permission case in the switch
independently returns `false`, and load-bearing the moment layer three landed: with the hard
return, a principal holding no membership never reaches the grant check, which is what
implements spec §9.5's "grants never widen into another tenant". The assertion was written
and **watched fail** by folding the hard return into the layer-two `if` — red alone at 1 of
406. *Cost if wrong: if grants legitimately should be honoured without membership, the spec
sentence is what is wrong, and that is a spec question to surface rather than code around.*

**`platform:administer` is excluded from layer three, at both ends.** An organization owner
or admin holds `grant:create`; without the exclusion they could issue a grant whose
permission *is* `platform:administer`, the hydrator would carry it, and layer three would
return `true` — falsifying `Permission`'s own documented claim that layer one is its only
route. Not reachable through today's single caller, which passes no resource; "not reachable
through the one caller that exists" is not "cannot happen". `AuthorizationService.createGrant`
refuses to issue it as well, so it is closed at the write end too. *Cost if wrong: a
deployment wanting per-resource platform administration must change two places. No such use
case exists in the spec.*

**Layer three is additive and non-authoritative, and both halves are now pinned.** See
[§2](#2-the-measurements). The assertion that *reads* as pinning additivity pins ordering;
the one that pins additivity is separate and was observed red alone.

**A store must persist `expiresAt` — asserted, seventh in the conformance suite.** Without
it a store could drop the column and still conform, making every grant permanently live; the
expiry rule lives only in the hydrator (R2), so nothing else would notice.

**`useCan` needs no exhaustive switch, and that is the design rather than a gap.** Adding a
16th `Permission` member fails **core's** build immediately via core's own `assertNever`, and
`nx run webapp:typecheck` never reaches the webapp because `core:build` is its dependency.
Patching `can()`'s switch to isolate the webapp side, `webapp:typecheck` then **passes** with
the new member — because nothing in `useCan` or the permission middleware **enumerates**
`Permission`. Both forward it to `can()` as an opaque value.

The webapp has nothing to be exhaustive *about*. A switch invented purely to be exhaustive
would be a test that exists to pass. The forcing function is core's, and it reaches the
webapp by construction: the webapp cannot compile against a core that does not build.

**The grep is what makes this load-bearing, and it was re-run after the pages landed.** Over
all non-test `apps/webapp/app/`: no `Record<Permission, …>`, no `Permission[]`, no
permission-string arrays, no literal permission strings outside opaque pass-through — only
single-value type positions in `useCan`'s signature and the route-meta type. Task 18 then
built the pages that would most naturally break it and did not: `GrantList`/`useGrants` are
deliberately read-only (list + revoke) **specifically** to avoid needing a permission-picking
dropdown, and `GrantList` renders `grant.permission` as a raw value with no switch.
*Cost if wrong: the day a page or menu hardcodes a list of `Permission` values, that list
silently misses a new member. The grep above is the check; it is manual.*

### Invitations and errors

**The three closed reasons are collapsed; never-issued stays distinct.** Revoked, accepted
and expired all answer `410` / `INVITATION_NO_LONGER_OPEN`; a token that named nothing
answers `404` / `INVITATION_NOT_FOUND`. The enumeration-oracle argument that justifies
collapsing "you may not" into "there is no such thing" elsewhere in this codebase **depends
on the identifier being guessable** — and a 32-byte CSPRNG token is not. Nobody can present a
token that was "real once" without having held it, so there is no set to enumerate, nothing
to close, and conflating them would only cost a person who clicked a forwarded, since-revoked
link a comprehensible answer. Recorded in
[ADR-0010](../../template/docs/adrs/0010-organization-invitations.md) and in
`InvitationNotFoundError`'s own TSDoc. *Cost if wrong: if a later phase makes invitation
tokens guessable or shortens them, this becomes a real oracle and both the error and its wire
mapping must be revisited together.*

**Openness is judged before the address.** Core requires it, and the reviewer's argument is
sharper than the brief's: **the reverse order leaks the worse thing.** The rightful holder
would get `410` while a wrong holder got `403`, telling a forwarded-mail recipient that the
token is addressed to somebody else — exactly the discrimination the three-state collapse
exists to shut. `403` for address mismatch is reachable only with a real **open** token, so
it confirms nothing new.

**Two defences against a double accept, closing two different paths.** A membership read
**inside** the accept transaction under the same lock closes the sequential path (admin
invites twice, recipient clicks both); a `23505` mapping to `AlreadyAMemberError` closes the
concurrent path, where two accepts of *different* tokens for the same address race past a
check each sees as clean. The two injections red **distinct** tests. The concurrent test
honestly labels itself as *simulating* the database, because `FakeDataSource` has no
constraints.

**A row lock, not `SERIALIZABLE`, for `acceptInvitation`.** Established rather than accepted:
the lock is taken at `findOne` **before** `isOpenAt` and held to commit; no eager relations,
so `FOR UPDATE` is a plain row lock; under `READ COMMITTED` a second transaction blocks,
re-reads the `ACCEPTED` row via EvalPlanQual and gets `410`; and the predicated
`UPDATE … status='PENDING'` with `affected !== 1` is a real second backstop. `SERIALIZABLE`
would have bought nothing here, because unlike `changeMemberRole`/`removeMember` there is no
multi-row invariant.

**`inviteMember`'s member check stays outside a transaction.** Its only failure mode is a
stale window producing a *redundant pending invitation* — never a duplicate membership — and
that invitation is refused at redemption by the two guards above, however it was issued.
*Cost if wrong: an organization accumulates several open invitations for one address; each is
single-use and all but the first are refused.*

**Every new domain error is mapped in `HttpExceptionFilter` by the task that ships it**, and
the not-found ones are `404` sharing `UserNotFoundError`'s message key, so the body cannot
reintroduce the leak the status closed. Two injections confirmed the two assertions catch
different faults: a missing mapping fails the *status* assertion; a split error shape fails
the *body* comparison while the status assertion stays green.

**`SERIALIZATION_CONFLICT` is a `409` with its own code and its own message key**, matched on
SQLSTATE (`40001`/`40P01`) rather than message text — duck-typed the same way the existing
`23505` check is — and distinguishable from `LAST_OWNER` and `ALREADY_A_MEMBER`.

### Tenancy and the schema

**No foreign key on `audit_entries`, and the static guard is a blanket rule with a
two-statement allow-list.** Narrowing it to "no *constraint-adding* `ALTER TABLE`" preserved
FK coverage completely and dropped `ALTER TABLE audit_entries OWNER TO <app role>` — which
voids D13 **more completely than any foreign key**, because the owner is not subject to the
`REVOKE` and can re-grant itself. It also dropped `DROP COLUMN`, `DROP NOT NULL`, unnamed
`ADD CHECK`/`UNIQUE`/`PRIMARY KEY`, `RENAME TO`, `INHERIT` and `ENABLE … RULE`. The restored
shape keeps the blanket rule and allow-lists the two permitted statements exactly,
whitespace-normalized, asserting **set equality**. Its own justification is the right one:
*"It changes only when somebody alters this table — which is precisely when a reviewer must
look — so the maintenance cost IS the guard working."*

**`invited_by_user_id`, `accepted_by_user_id` and `granted_by` are `UserId | null` in core.**
The codebase had already chosen this pattern and already documented it: `AuditEntry.actorId`
is nullable, and the identity migration's comment says such a column "holds a user id that
may name nobody, and readers treat a missing user as expected rather than as corruption."
Making the columns `RESTRICT` instead would block account deletion, which `DELETE /users/me`
must support, and a mapper that casts a null into a non-nullable branded id is precisely the
unsoundness `to-user.ts` exists to prevent.

**Two queries, not one SQL JOIN, for `listOrganizations`.** The property that matters is that
`organizations` is never read unscoped, and it holds — the membership lookup comes first and
`organizations` is filtered by `id: In(...)`. The backend's `FakeDataSource` has no query
builder and no other service uses one, so a JOIN would have meant new test-double machinery
for no gain. Crucially **the fault is still injectable**: replacing the pair with a plain
`find()` reads every organization, which is how D9's injection works.

**`[organizationId]` routing, not `[slug]`.** Routing by slug is not free elegance — it is a
resolution step with real failure modes (a stale slug, a race with a rename) bought for zero
functional gain, since `can()`'s role layer reads only `resource.organizationId` and no
endpoint on that path takes a slug. The slug is created, edited, displayed and unique; it is
in no URL, and its TSDoc now says so in those words. *Cost if wrong: organization URLs carry
uuids; a later phase wanting slugs adds resolution then — the same work deferred, not
duplicated.*

### Conformance and test design

**DEC-1 now has its evidence, and the injection that produces it is not the obvious one.**
See [§3](#3-where-the-plan-was-wrong-and-testing-found-it) row 13 and
[§2](#2-the-measurements). The split held up under a harder check too: driving the shared
suite from the webapp's stub, a reviewer read all 481 new `stubBackend` lines and confirmed
the stub **serves without enforcing** — `requireOrganizationMembership` exists because the
contract requires that behaviour (proven by the cast injection needing it), `grantRoutes`
deliberately does *not* check actor membership, and there is no `PermissionsGuard`-equivalent
role logic anywhere in it.

**No trailing whole-object round-trip comparison where concrete fields are already asserted
against literals.** `expect(revived.toJSON()).toEqual(original.toJSON())` largely restates
the `toJSON` tests, and two reviewers flagged it in two consecutive tasks. Two occurrences is
a pattern; a reviewer warned it was about to calcify as house style, and the cheapest moment
to stop it is before three more tasks copy it. *Cost if wrong: a marginally thinner test where
the round-trip would catch a field transposition the literals missed — which they catch
already, since each field uses a distinct value.*

**Conformance assertions must discriminate the wrong rule, not just the absent one.**
Assertions 10/11 exercised only `owner` acting on `owner` — exactly the case the wrong
`target === actor` implementation also passes. The backend satisfied them by being correct,
but the shared suite would not have caught the bug, and the webapp is driven by the same
assertions, so a client stub with the naive rule would have conformed. Strengthened to
`admin` acting on `owner`, with the evidence being that the **conformance** tests now go red
under the same injection.

**A refusal assertion is paired with a control that a refuse-everything implementation
fails.** Applied without being asked from Task 13 onward: each new authorization case ships
with an `ADMIN` control, and the controls were themselves verified to discriminate by making
the guard refuse unconditionally and watching them break.

### Ports and documentation

**ADR-0008 was corrected, not the code.** It said "every external capability is a port — an
interface in core", and `IMailer` and `IPasswordHasher` live in the backend deliberately;
`IMailer`'s own TSDoc argued against the ADR that governed it. Moving them into core would
import transport and storage vocabulary into the one package whose value is that it carries
none — and core's purity rule is not a style preference a port may be excused from, it is the
reason a contract in core means anything. The ADR now carries **"Where a port lives, and the
test for deciding"**: a port belongs to the layer whose vocabulary the capability is stated
in — core when a domain rule has to name the capability (`IBreachedPasswordRegistry` is that
case, because `PasswordPolicyViolation.BREACHED` is a domain outcome), the app when only the
app's plumbing does. Everything else in the ADR applies identically in both places. *Cost if
wrong: two interfaces and their DI tokens move packages; no call site changes shape, because
both are already injected by symbol token.*

### Process

**Minors are ledgered, not looped** — Phase 2's rule, carried and honoured: thirteen open
minors reached [§8](#8-the-triage) rather than thirteen fix rounds.

**Five fix rounds is a cap, and at the cap you adjudicate rather than send a sixth.** Task 9
hit it. Two findings were **parked with a ruling** rather than fixed: five rounds of
enumerate-and-patch had demonstrated *empirically* that enumeration does not converge, and a
sixth round of the same move is the move the evidence says fails. Parking was safe because
the shipped schema is correct — no migration uses either construct — and because D13 itself
is a **runtime** test against a real database, which this static guard is defence-in-depth
on top of. The structural fix was **carried, not lost**, into Task 22a, and both items landed
there.

**Escalate when the loop is iterating on the approach rather than on the bug.** Task 9's
rounds 1–3 each closed one spelling and each was followed by another; that is not three
oversights but one design error. Round 4 went to a **fresh** implementer on a stronger model
with the task reframed (normalize, then match), and it found three live holes none of the
three prior rounds would have reached.

**No agent is asked an unbounded empirical question.** See [§4](#4-my-own-claims-corrected)
item 2.

**Read-only verification in `~/Progetti/Voku` is required, not forbidden.** See
[§4](#4-my-own-claims-corrected) item 7. Verified clean and unchanged at `fdfdbde` before and
after every task in this phase.

**A worker does not dispatch subagents, and a disclosed breach with independent remediation
is accepted.** Task 21's implementer dispatched an Explore agent despite the instruction,
then could not stop it because it did not own it. It **volunteered the whole thing**, redid
all research directly before writing any code, and did not use the subagent's report for any
decision — the report arrived after the walk was already written. The rule exists because
worker-spawned *reviewers* duplicate the controller's review seat; research is a lesser
breach, but it is still the rule, and **the honest disclosure is what made the remediation
checkable rather than a claim.**

---

## 6. Documented, not fixed

Each of these is real, each was considered, and each is here rather than in the code for a
stated reason.

| | Why it is not fixed |
|---|---|
| **D12 has no route to exercise it** | Layer three fires nowhere, and making it fire means designing a production guard mechanism rather than writing a test. Ships as a labelled partial with a 23-line TSDoc that says so, plus a tripwire that reds the day a `can()` call site names a record. See [the five](#the-five-worth-knowing-before-you-touch-the-code) item 5. |
| **Two static-guard gaps parked at Task 9's cap, later closed** | `E'…'` escape strings and identifier-adjacent `$`. Parked with ruling T9-e, **closed in Task 22a** by the fail-closed whitelist. Recorded because the parking decision — and the reasoning that made it safe — is the precedent, not the outcome. |
| **The `migration-sql` extractor cannot see SQL it is not shown** | Two standing gaps: SQL that is not a string literal at the call site, and TypeORM's `QueryRunner` schema API. **Both closed in Task 22a** — the second by an allow-list of one method (`query`), enforced by two ESLint rules with three named, reasoned exemptions pinned by set equality, and no new dependency. |
| **The exemption pin keys on file + rule name only** | Moving an exemption *within* a file passes silently. Recorded, not actioned. |
| **`FakeDataSource` enforces no unique constraints** | Every uniqueness invariant in this backend is invisible to the fast tier; only the real schema stands behind them. Not a defect to fix in the fake — Phase 2's rule holds, *a fake that is wrong is worse than one that is limited* — but it is why the real-database tier is not optional. |
| **The null-inviter path is unreachable from the fast tier** | `FakeDataSource` has no foreign keys, so `ON DELETE SET NULL` cannot happen there at all: deleting a user row leaves a **dangling** id, which is a different state from a nulled column. Faking it would have asserted the wrong thing, not merely a weaker thing. The clauses themselves are asserted in `migration-sql.spec.ts`, per column. |
| **`migration-sql.spec.ts` now holds two matching styles** | Task 9's normalizer for **security** guards that must resist a hostile or careless migration, and raw source text for **schema-shape** assertions that only ask whether we wrote the clause we meant. Different risk, defensible split — but it should be a stated split rather than an accident. In the triage. |
| **The webapp's `ApiErrorCode` list is a hand-maintained snapshot** | Pinning it to the backend's derived `DOMAIN_ERROR_CODES` was ruled out **on inspection, not assumption**: that export lives in a file importing `@nestjs/common` at its top, so reaching it from the webapp means importing NestJS into the Nuxt bundle. What makes it honest rather than a shrug: the TSDoc now says the list is hand-maintained and pinned only against renaming, and names the one claim that *is* enforced — every code a service switches on must be a union member, which the compiler checks via TS2678. That is finding the genuine assertion inside the fake one rather than deleting the fake one. |
| **`platform:administer`'s refusal is a case-sensitive literal comparison** | A differently-cased payload slips it — but `can()`'s own exclusion is equally literal, so such a value is **inert** rather than an escalation while layer three is consumed by nothing. It becomes real the moment a consumer wires layer three; recorded for whoever does. |
| **Storybook's build still fails, root cause still unknown** | `✓ 0 modules transformed`, then `[vite:build-html] Missing field 'moduleType'`. Reproduced again on 2026-09-20 against a freshly generated project installed with `npm ci` against the lockfile that pins the combination once believed to be the fix. It stays **PR-only and non-blocking, deliberately** — see [§7](#7-out-of-phase-3-named-so-they-are-not-lost). |
| **The template is still unverified on the Node it declares** | There is no real Node 22 on this machine; every `node@20`…`node@26` symlink aliases one Node 26.5.0 keg. The Docker images are the only place anything ran on Node 22 this phase. |
| **The load-sensitive controller-spec flake** | Two sightings, two files, same shape. Capped rather than chased, for the reason in [§4](#4-my-own-claims-corrected) item 2. |
| **`audit.service.ts` still hand-builds a `Principal` literal** | A second place the principal's shape is stated, now that `PrincipalService` exists to state it once. Pre-existing; in the triage. |

---

## 7. Out of Phase 3, named so they are not lost

- **Phase 2's SSR-credential ruling is discharged.** The payload a signed-in visitor is
  served now carries no credential, `private, no-store` stays, and the discriminator is the
  store's own `status` rather than a new flag: `awaitingRenewal() = status ===
  'authenticated' && credential === null`, which a *refused* renewal cannot produce because
  `attemptRenewal` always calls `forget()`. Phase 2's log §6 has been updated with what
  actually shipped and the two things its plan did not say.
- **D12 needs a route.** The first per-record route a later phase adds — or a fixture
  resource controller in the test app — is what makes it testable. The tripwire will say so.
- **`IBreachedPasswordRegistry` still has no conformance suite**, because the shipped
  implementation answers `false` unconditionally. Unchanged from Phase 2; now stated in
  `libs/core/README.md` as one of three documented departures rather than as an
  unacknowledged exception.
- **D11 (OAuth email-match linking) needs Phase 4. D10 (MFA challenge) needs Phase 5.**
- **Audit retention.** `audit_entries` still grows without bound and the application still
  cannot prune it, by design. Carried from Phase 2, not addressed here.
- **Storybook's exit condition is recorded in the workflow, not in anyone's memory.** When
  the `moduleType` failure is root-caused, the job flips **twice in one commit**:
  `continue-on-error` comes off and `if:` becomes `github.event_name != 'schedule'`, like the
  other slow tiers. Not before — a green-but-PR-only Storybook job would re-open the gap Task
  20 just closed, in the one tier nobody is watching. And running a permanently-red job on
  every push buys zero protection while training people to read a yellow CI page as normal.
- **A guard's failure message is part of its design.** Task 22a's trap is the general form:
  whenever a refusal has an obvious one-line remedy that reopens what the refusal exists to
  close, the message must give the author a way to get unstuck *without* reaching for it.
  Worth a review dimension in a later phase.

---

## 8. The triage

**Thirteen minors were deferred rather than looped**, per the Phase 2 rule. They are listed
here with enough evidence that the final review can act on each without re-deriving it. The
Phase 1 test applies: *does this affect a real user of a generated project?*

| # | Task | The item | Why it was deferred, and what it would take |
|---|---|---|---|
| 1 | 1 | **`tools/sanitize.mjs` misses no-separator compounds.** `OrganizationInvitation` slips every rule, before and after this phase's widening — the bare-word term rule has no camelCase/PascalCase boundary handling the way the `event`/`payment`/`ticket` rules do. | Pre-existing gate limitation, not introduced here. Live now: the template ships `mail/templates/organization-invitation.ts`. Fix is boundary handling in one rule, in its own commit — never inside a feature task. |
| 2 | 2 | **No `LoginForm.spec.ts` case for the exhaustive switch.** | Low risk: guard 1 is self-protecting via webapp typecheck, which now fails automatically when `AuthenticationOutcome` grows a variant. Adding the case costs about four lines. |
| 3 | 3 | **`fromJSON` round-trip tests in `Organization.spec.ts` / `Membership.spec.ts` are close to tautological** — `expect(revived.toJSON()).toEqual(original.toJSON())` largely restates the `toJSON` tests. | The coverage gate trading assertion strength for 100% on paths only later tasks exercise for real. Ruling T4-c stopped the pattern spreading from Task 5 onward; these two are the residue. |
| 4 | 4 | **Same round-trip shape, second occurrence** (`Invitation.spec.ts`). Mitigated — each test pins concrete fields against literal constants first. | Two reviewers flagged it; the rule that stopped it is in [§5](#5-the-rulings). Removing the trailing comparison loses nothing the literals do not already catch. |
| 5 | 10 | **`createOrganization`'s audit test compares `entry.organizationId` against the service's own return value**, unlike its update/delete siblings, which use a literal seeded id. | Judged **not** a tautology — the two values come from independent write paths (the audit-row write and entity construction) — but weaker than its siblings. Tighten by reading the value back from the store. |
| 6 | 10 → 16 | **`api-error-code.spec.ts`'s comment claims "the same eleven names"; the backend table has 14.** | Carried into Task 16 with the snapshot finding and partially addressed there (the codes were added); the *count* in the comment is the residue. One line. |
| 7 | 13 | **`audit.service.ts` still hand-builds a `Principal` literal** rather than using `PrincipalService`. | Pre-existing, and harmless today. It is a second place the principal's shape is stated, now that a hydrator exists — which is exactly the shape that drifts. |
| 8 | 14 | **The `platform:administer` refusal is an exact case-sensitive literal comparison.** | Inert while layer three is consumed by nothing, because `can()`'s own exclusion is equally literal. **Becomes real the moment a consumer wires layer three** — pair it with D12's tripwire. |
| 9 | 15 | **`migration-sql.spec.ts` now holds two matching styles** — Task 9's `canonicalStatements()` normalizer, and raw source text for the new `ON DELETE SET NULL` assertions. | Not a *new* brittleness: it deliberately follows the file's pre-existing sibling block, with a comment saying why it is not hoisted. Defensible split (security guards versus schema-shape assertions) — **but it should be a stated split rather than an accident.** Cost: a paragraph in the file's TSDoc. |
| 10 | 16 | **The claimed alphabetical fix is itself wrong.** The backend sorts `DOMAIN_ERROR_CODES` with `.localeCompare()`; the webapp's list was verified with bare `Array.prototype.sort()` (UTF-16 code-unit order). They disagree on exactly one pair — `INVITATION_NOT_FOUND` vs `INVITATION_NO_LONGER_OPEN` — because `'INVITATION_NOT_FOUND'.localeCompare('INVITATION_NO_LONGER_OPEN')` returns `1` while code-unit order returns the opposite. **The verification passed because it used the wrong comparator.** | Breaks no test, since each file's literal only checks itself — but it defeats the exact property both files' comments claim ("sorted, so the two lists can be compared by eye"), which is the **entire defence** of the snapshot route. One line; the highest value-per-character item in this table. |
| 11 | 17 | **`useInvitations.load` hardcodes the `PENDING` filter** rather than taking a status parameter defaulting to `PENDING`. | A real design choice, but it forecloses an invitations-history view without a fetcher bypass — and W2 makes the composable the only sanctioned path. |
| 12 | 19 | **`auth-init.client.ts` awaits `store.renew()`, and Nuxt holds the mount for an async plugin.** Departure 4 argues only the request-doubling half. Unstated: every full page load for a signed-in visitor now inserts a backend round trip before hydration completes, and a **hung** renewal blocks interactivity indefinitely — `createApiClient` has no timeout. | **Weigh this one first.** `status` is already seeded, so the app can render authenticated immediately and `createAuthFetch` would renew on the first `401` via the `awaitingRenewal` path. If that holds, *not* awaiting is strictly better. Every generated project inherits this. |
| 13 | 19 | **`dependsOn` is inert-if-renamed, silently.** Nuxt filters on `p._name`, so if `@pinia/nuxt` ever renames its plugin the belt becomes a no-op with no warning. | The "inert grep" shape these decision logs are organised around. Harmless *today* only because the `if`-guard is what actually holds. One sentence in the comment. |

Two more were recorded and are not in the thirteen because they were judged closed where
they stood: **deleting the `audit:read` annotation yields `403` rather than `404`**, because
`AuditService` re-checks `can()` independently — defence in depth, not observable in shipped
code since the guard fires first; and a **third `migration-sql.spec.ts` assertion that
appeared to repeat a falsified claim** turned out to be past-tense and sound, describing the
history that produced a suite rather than issuing a live instruction. A third,
[§6](#6-documented-not-fixed)'s exemption-pin gap, is recorded but not actioned.

And **one minor was plan-side and is already closed**: a brief said "nine action members"
while its own list gave ten; ten landed, the code is right, the plan was corrected.
