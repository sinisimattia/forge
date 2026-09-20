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
