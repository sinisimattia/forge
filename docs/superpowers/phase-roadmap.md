# Forge — Phase Roadmap

Phases 1 and 2 are built. This records how the remaining work is decomposed and, more
importantly, **the ordering decisions that exist to avoid rework**. They are easy to get wrong
and expensive to undo.

The spec (`docs/superpowers/specs/2026-09-17-forge-template-design.md` §9) describes the whole
identity platform as one thing. It is not one plan. It is four.

| Phase | Ships | Status |
|---|---|---|
| **1. Generator + template skeleton** | `npm run create` produces a bootable, agent-ready NX monorepo. No auth. | **BUILT** |
| **2. Identity foundation** | Users, auth identities (password provider), sessions with rotating refresh tokens, email verification, password reset, the append-only audit log — and the whole client half: services over the wire, the auth store, route middleware, and the pages a person actually uses. | **BUILT** |
| **3. Organizations + authorization** | Orgs, memberships, invitations, `can()` as pure core logic, roles, per-resource grants, guards. | specified, not written |
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

**3. Phase 2's own discoveries, which Phase 3 must not get wrong.** Each of these cost a
fix round to find; see `phase-2-decision-log.md` for the evidence behind them.

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
- **Widen the sanitize gate's `invitations?` rule before Phase 3 starts, not during.** Spec
  §9.4 makes organization invitations a first-class concept and the gate bans the bare noun.
  The right shape is the one `event`, `payment` and `ticket` already have: ban the source
  project's compounds, not the word. Change the gate in its own commit, never inside a
  feature task.
- **ADR-0006's actual rule is cited by no review dimension in any package.** Phase 3 ships
  `can()` behind a guard and owes it a row.
- **Take the access credential out of the SSR payload.** Ruled on 2026-09-20 after Mattia read
  the trade: Phase 2 ships with the exposure documented, Phase 3 removes it, because Phase 3
  reopens the renewal path for tenancy anyway and the change lands beside work rather than on
  top of working code. Four things are owed, and none of them needs re-deriving —
  `phase-2-decision-log.md` §6 has the mechanism and the cost. In short: seed `status` and the
  user but not the credential; add `app/plugins/auth-init.client.ts`; handle the
  `presented() === null` 401 that `createAuthFetch` today rethrows *without* renewing, on
  purpose, because that is what stops a mistyped password signing the visitor out; and get the
  second renewal race right, or reuse detection revokes the family. The no-flash behaviour is
  not at risk — the three-state `status` is what prevents the flash, not the token.

## What the final whole-branch review left for Phase 3

Phase 2's final review returned **MERGE, no blockers**, and six findings that are real but do
not make any shipped behaviour wrong. Each was measured; none needs re-deriving. Four of the
six are the phase's own theme — *a check that passes because it never ran* — which is why they
are listed first rather than filed as chores.

- **`AuthenticationOutcome`'s forcing function does not reach the webapp.** Core's TSDoc says
  every consumer ends its `switch` with `assertNever`. Injecting a third status member fails
  `core` and `backend` typecheck (TS2345 `'never'`) and **`webapp` passes**: its three consumers
  (`stores/auth.ts:229`, `LoginForm.vue:63`, `useAuth.ts`) use `if`. A new member would render
  as a sign-in refusal, silently. Phase 5 adds `MFA_REQUIRED`, so this is the branch the whole
  design exists to make loud.
- **A third masked assertion, and the first two were fixed.** `runIAuditServiceContract.ts:439-473`
  checks ten wire fields, but the backend driver seeds `organizationId`, `clientAddress` and
  `clientLabel` as `null`, so three are null-symmetric. Measured: dropping `organizationId`
  from `AuditService.toEntity` leaves **499/499 green**; dropping the client columns fails a
  *different* test while the wire-shape test stays green. Core's own driver seeds non-nulls with
  a comment saying why. **Phase 3 is tenancy — `organizationId` is exactly the field that stops
  being null.**
- **`libs/core`'s 100% coverage thresholds run in no CI at all** — not `ci.yml`, not
  `project.json`, not the integration gate. The coverage is real and was verified; nothing
  enforces it. The plan said Task 18 owned closing this and Task 18 did not.
- **The layer checker has no test that injects a layering violation**, and with `app/pages` and
  `app/layouts` moved aside it prints `clean (44 component(s) and 0 page(s)/layout(s) checked)`
  and exits 0. Its vacuous-pass guard covers the mirror case only — the axis added when Task 17
  extended it to pages is unguarded.
- **ADR-0008 says "every external capability is a port — an interface in core", and that is
  false.** `IMailer` and `IPasswordHasher` live in the backend, deliberately, and
  `IMailer.ts:21-27` argues against the ADR that governs it. Fix the ADR or move the ports;
  do not leave them contradicting each other.
- **`libs/core/README.md` claims one contract per domain and one suite per contract.** Identities
  has two contracts, auth has two suites, and `IBreachedPasswordRegistry` has none. Its `shared/`
  inventory also omits `shared/policies`, which is load-bearing.

Also carried, smaller: **a direct push to `main` runs only the `unit` tier** — `generated-project`,
`storybook` and `docker` are all `if: pull_request`, so the gate this phase spent a task building
does not run on the branch it protects. The gate list exists twice (root `affected` and `ci.yml`)
with nothing pinning them together. Two tautological assertions remain
(`auth.controller.spec.ts:419`, whose own comment argues against it, and
`composition-root.spec.ts:289`). `users.controller.spec.ts:197` sweeps for a secret in a world that
has none. Nine more stale doc claims across D4–D13. And spec §12 step 5, run fresh, leaves one
un-triaged residue: `https://placehold.co` in `AppImage.stories.ts:4`.

**Not verified anywhere in Phase 2:** the template on the Node it declares. This machine has only
`v26.5.0` and no version manager, so every run — including the final review's — was on Node 26
while `template/package.json` says `>=22 <23` and both Dockerfiles pin 22. The gate's new mismatch
warning fired correctly every time, which is the guard working and the coverage still missing.

## What Phase 3 inherits, already built

| | Where |
|---|---|
| `can(principal, permission, resource?)`, layer one and ownership | `libs/core/src/authorization/policies/` — **not** `shared/policies/`, which is for primitives with no domain dependency |
| `Permission` (three members) and `Principal` | `libs/core/src/authorization/types/` |
| `PlatformRole`, the first of ADR-0006's three authorization layers | `libs/core/src/users/enums/` |
| a nullable `organizationId` on `AuditEntry`, its column, and `AuditQuery.organizationId` — deliberately unpinned by any assertion, because no world can hold two tenants yet | `libs/core/src/audit/`, `audit_entries` |
| `PlatformAdminGuard` + the interceptor that records every pass **after** the handler | `apps/backend/src/auth/guards/` |
| the conformance split, and a vitest and a jest adapter for it | `libs/core/src/*/testing/`, `apps/backend/src/common/testing/`, `apps/webapp/app/services/__tests__/` |
| the two database roles and the start-up privilege guard | `apps/backend/src/db/` |

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

The rulings behind both, and everything else decided along the way, are in
`phase-1-decision-log.md` and `phase-2-decision-log.md`. Read the second one's opening five
before touching the identity foundation.
