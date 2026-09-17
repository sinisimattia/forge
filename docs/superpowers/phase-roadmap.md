# Forge — Phase Roadmap

Phase 1 is built. This records how the remaining work is decomposed and, more importantly, **two
ordering decisions that exist to avoid rework**. They are easy to get wrong and expensive to undo.

The spec (`docs/superpowers/specs/2026-09-17-forge-template-design.md` §9) describes the whole
identity platform as one thing. It is not one plan. It is four.

| Phase | Ships | Status |
|---|---|---|
| **1. Generator + template skeleton** | `npm run create` produces a bootable, agent-ready NX monorepo. No auth. | **BUILT** |
| **2. Identity foundation** | Users, auth identities (password provider), sessions with rotating refresh tokens, email verification, password reset, and the append-only audit log. | specified, not written |
| **3. Organizations + authorization** | Orgs, memberships, invitations, `can()` as pure core logic, roles, per-resource grants, guards. | specified, not written |
| **4. OAuth + account linking** | Google/GitHub/OIDC adapters behind one port. | specified, not written |
| **5. MFA** | TOTP + WebAuthn, two-phase login, recovery codes. | specified, not written |

## The two ordering decisions

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

## What "done" means for each phase

The same bar Phase 1 met: a generated project passes its own `lint`/`typecheck`/`test`/`build`/
`purity`, boots under Docker, and the new work is covered by tests that have been **observed to
fail** when their fault is injected. A green suite is not evidence.
