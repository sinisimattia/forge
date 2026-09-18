# Forge Phase 2 — Identity Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generated project ships a real identity platform — users, auth identities split from users, sessions with rotating refresh tokens, email verification, password reset, and an append-only audit log — with `libs/core` holding the contracts, both apps implementing them, and every security property covered by a test that has been **observed to fail** when its fault is injected.

**Architecture:** Contracts and domain rules live in `libs/core` as pure TypeScript and are the only shared truth. The backend implements them over TypeORM/Postgres and owns everything about transport — token format, where a credential is carried, guards. The webapp implements the *same* contracts over the wire. One shared conformance suite per contract is driven by both apps; a second, backend-only suite carries the security invariants that only a real implementation can honestly prove. The audit log's append-only guarantee is a database grant, not a convention.

**Tech Stack:** Unchanged from Phase 1 — Node 22, NX, NestJS 11 + TypeORM 0.3 + PostgreSQL 16, Nuxt 4 + Vue 3 + Pinia, Jest (backend, core), Vitest (webapp), Docker Compose. New template dependencies in this phase: `argon2` (or the fallback Task 9 selects), `@nestjs/jwt`, `cookie-parser`, `nodemailer`, `supertest` (dev). Forge itself stays dependency-free.

**Spec:** `docs/superpowers/specs/2026-09-17-forge-template-design.md` — §9 is the platform; Phase 2 is §9.1–9.3 plus the audit log in §9.6, the Phase-2 rows of §9.7, and the Phase-2 slice of §9.8.

**Roadmap:** `docs/superpowers/phase-roadmap.md` — read the two ordering decisions before Task 4. They are the reason this plan splits `AuthIdentity` from `User` on day one and models login as a discriminated outcome rather than a token.

**Phase 1 decision log:** `docs/superpowers/phase-1-decision-log.md` — 63 rulings. Several look like style choices and are not.

---

## Decisions taken before this plan was written

These four were open in the spec and were decided by Mattia on 2026-09-18. They are binding; a task that finds one of them wrong reports it rather than quietly choosing differently.

**DEC-1 — Conformance is a split suite, not full parity.** Core ships two suites per contract:

- `runI<X>ServiceContract` — the **shared** suite. Behaviour both implementations genuinely share: outcome discrimination, error mapping, domain invariants, and agreement on the JSON wire shape. Driven by the backend (jest) *and* the webapp (vitest).
- `runI<X>ServiceSecurityContract` — the **backend-only** suite, driven by the backend alone, against a real implementation.

Rationale: the webapp's implementation is exercised against a stub of the backend's wire shape (the pattern Voku established in `apps/webapp/app/services/event.service.conformance.spec.ts`). That is sound for shape agreement and worthless for security properties — a webapp "proof" that a refresh-token family is revoked would only be proving that a stub I wrote does what I told it to. Security invariants are asserted where they are real: the backend, and for D13 the database.

**DEC-2 — The audit guarantee is two database roles.** Migrations run as the schema owner; the application connects as a separate, restricted role. `ALTER DEFAULT PRIVILEGES` grants the app role `SELECT, INSERT, UPDATE, DELETE` on tables the owner creates afterwards, and `audit_entries` then has `UPDATE`/`DELETE` revoked from the app role specifically. This touches Phase 1 files (`compose.yaml`, `compose.prod.yaml`, `.env.example`, `src/db/data-source.ts`, `app.module.ts`) and that invasiveness is accepted. Default privileges are used rather than per-table grants so that a table added in Phase 3 is covered automatically — a generated project must not have a "remember to grant" step.

**DEC-3 — Refresh credential in an httpOnly cookie, access token in memory.** The refresh credential is set by the backend as an httpOnly, `SameSite=Lax`, path-scoped cookie that JavaScript never reads. The short-lived access token lives in the webapp's Pinia store and is lost on reload, re-minted through `POST /auth/refresh`. Consequence, which Task 16 must handle rather than discover: a full page load in Nuxt starts unauthenticated and must re-mint during SSR, forwarding the incoming cookie on the server side.

**DEC-4 — The platform-admin endpoints ship in Phase 2.** `GET /users`, `GET /users/:id`, `PATCH /users/:id/platform-role`, `PATCH /users/:id/status`. They depend on `platformRole` only, never on an organization. Deferring them would ship `platformRole` with no enforcement path.

---

## Global Constraints

Every task's requirements implicitly include this section.

### Inherited from Phase 1 — do not relitigate

- **Node `>=22 <23`** everywhere — forge itself and every generated package.
- **Forge itself has zero runtime and zero test dependencies.** `tools/` and `tests/` use Node builtins and `node --test`. The *template* has real dependencies; forge does not. (ADR-0002.)
- **`~/Progetti/Voku` is strictly read-only.** Read it freely. Never write, never `git add`, never branch, never stash, never check out. After every task that touches it: `git -C ~/Progetti/Voku status --porcelain` must be empty and `git -C ~/Progetti/Voku rev-parse --short HEAD` must be `fdfdbde`. Report both.
- **Tokens are `__FORGE_NAME__`, `__FORGE_TITLE__`, `__FORGE_SCOPE__`, `__FORGE_DESCRIPTION__`, `__FORGE_DB_NAME__`.** No other spelling is valid. Every new template file that names the project must use them.
- **Zero source-project traces.** `grep -ri voku template/ tools/` returns nothing. Neutral example vocabulary in docs is `Article` / `Comment` / `Tag`.
- **`npm run sanitize` must pass before any commit that touches `template/`.** Do not weaken a rule to make a commit pass. If a literal genuinely must stay, mark that line `# sanitize:allow — <reason>`; the gate prints every exemption it honours. Phase 1 ends with exactly one exemption — if this phase pushes the count past one, tighten the marker to per-rule granularity (that trigger is recorded in the Phase 1 log).
- **`libs/core` purity, enforced two ways.** `libs/core/eslint.config.mjs` bans framework imports (static, dynamic and `require`); `libs/core/scripts/check-purity.mjs` bans transport vocabulary in *prose*. The forbidden prose substrings are, case-insensitively, `jwt`, `cookie`, `typeorm`, `pinia`, `nuxt`, `vue`, `nest.js`/`nest_js`/`nestjs`/`@nestjs`, `http`/`https`; plus `express.js`, `@express` and the capitalised `Express` (case-sensitively — the lowercase English verb is allowed). Matching is **substring**, so `SessionCookie`, `jwtToken` and `useCookie` are caught. Real `https://` links are stripped before matching; nothing else is.
- **`libs/core` coverage thresholds are 100%** for statements, branches, functions and lines (`libs/core/jest.config.js`). Every executable line added to `libs/core/src` must be covered by a test in `libs/core/tests`. Interfaces, barrels, `types/` and `*ContractDeps` are excluded from coverage by config — code with runtime behaviour is not.
- **Core tests live outside `src/`**, under `libs/core/tests/`, mirroring the `src/` structure, and import the code under test through its public `__FORGE_SCOPE__/core/<domain>/<folder>` subpath — never a relative path into `src/`.
- **`libs/core` layout rules:** per-domain folders, one exported symbol per file named after the symbol, an `index.ts` barrel per folder, subpath-only exports, `I`-prefixed contracts, contracts speak in entities, TSDoc on every export, money as integer cents, UTC `Date` in entities and ISO-8601 strings on the wire, specific `DomainError` subclasses never the base class.
- **The base `tsconfig.json` does not set `module`/`moduleResolution`, deliberately.** Setting `moduleResolution: "Bundler"` there makes any CommonJS package extending it fail with `TS5095`. Each package owns both options. Do not "fix" the base config.
- **Never touch a Docker container you did not create.** This machine runs unrelated live containers, including a Postgres on 5432. Allocate free ports with `net.createServer().listen(0)` and publish through the `POSTGRES_PORT`/`BACKEND_PORT`/`BACKEND_DEBUG_PORT`/`WEBAPP_PORT` overrides. Never `docker stop`, `docker rm`, `docker system prune` or reconfigure anything you did not start, and always scope compose commands with the per-run `-p` project name.
- **Known broken, not yours:** the template's Storybook build fails with `[vite:build-html] Missing field 'moduleType'`. Dependency drift was tested and **falsified** as the cause; the root cause is unknown. Forge's storybook CI job is `continue-on-error: true`. Do not chase it, do not re-adopt the drift explanation, and do not let it block a task.

### New for Phase 2

- **Every new template dependency must be justified in the task that adds it, and the lockfile refreshed.** `template/package-lock.json` ships. After changing any template `package.json`, run `npm run refresh-lockfile` from the forge root and commit the result. A dependency added without a lockfile refresh breaks `npm ci` in both Dockerfiles.
- **No secret, key or credential may be invented.** Ports, not vendors (ADR-0008). The mail adapter that ships writes to disk; it binds no account. Every signing secret is read from the environment with no default in production paths, and dev compose carries obviously-local values inline exactly as Phase 1 established.
- **A rejection reason is never serialized to a client on an authentication path.** `AuthenticationRejectionReason` exists so the *server* can audit precisely. `POST /auth/login` and `POST /auth/forgot-password` return responses that are indistinguishable between a known and an unknown email (D7). Any task that adds a reason to a response body has broken D7.
- **Adding a branch to `AuthenticationOutcome` must be a compile error for every consumer, not a silent fallthrough.** Every `switch` over the outcome ends in an `assertNever` default. This is what makes Phase 5's `MFA_REQUIRED` branch cheap, and it is the whole point of roadmap ordering decision 2.

### How to work — carried from Phase 1 because it is why Phase 1 worked

- **Treat this plan as a set of hypotheses, not a specification.** Twelve times in Phase 1 a prescribed fix was wrong and an implementer caught it by testing before applying — a regex that false-positived on the real file, a `\bevent\b` grep that cannot match `eventId`, a claim that `npm ci` with no lockfile is a harmless no-op when it errors outright. If a step's literal code does not work, **test it, then report the failure and your correction**. Do not silently comply, and do not silently deviate. `DONE_WITH_CONCERNS` asking the controller to confirm intent is the right escalation.
- **A guard nobody has watched fail is not a guard.** Every discriminating test in this plan must be run with its fault injected and observed to fail, then observed to pass once the fault is removed. Report the verbatim failure output.
- **A claim about evidence is not evidence.** Phase 1 caught four separate cases of inaccurate evidence in otherwise-correct work — a RED log pasted from a different test, a fixture claimed to fire that could not have. If you did not run it, say "NOT VERIFIED". Candid self-retraction is the behaviour being rewarded here.
- **Domain and vocabulary greps are substring, not word-boundary.** `\bevent\b` matches none of `events`, `eventId`, `userPaymentSummaryByEvent`. Triage hits by hand.
- **BSD `sed` silently ignores `\b`** — it exits 0 and changes nothing. Use `perl -pi -e` with ASCII-only patterns for in-place edits.
- **`node --test <directory>` does not work** — it treats the directory as a test file and runs nothing. Use a glob.
- **Stage explicit paths when committing.** Never `git add -A` while another agent may be writing.

---

## File Structure

### `libs/core` — the contracts (Tasks 2, 4–7)

`shared/` gains cross-domain primitives; four new domain folders follow the per-domain layout exactly.

| Path | Responsibility |
|---|---|
| `src/shared/types/PaginatedResult.ts` | `{ items, total, page, pageSize }` — every list contract returns this |
| `src/shared/policies/assertNever.ts` | Exhaustiveness helper; makes a new outcome branch a compile error |
| `src/shared/policies/normalizeEmail.ts` | The single definition of email identity (trim + lowercase) |
| `src/users/` | `User`, `UserStatus`, `PlatformRole`, `IUserService`, profile rules |
| `src/identities/` | `AuthIdentity`, `AuthProvider`, `IIdentityService`, linking invariants, password policy |
| `src/auth/` | `Session`, `AuthenticationOutcome`, `IAuthService` |
| `src/audit/` | `AuditEntry`, `AuditAction`, `IAuditService` |

**`policies/` is a new, seventh sanctioned subfolder** alongside `entities/ contracts/ enums/ errors/ types/ testing/`. It holds pure functions — the only place in core where a function that is not a method may live. Phase 3's `can()` lands here. Task 3 adds it to `libs/core/STANDARDS.md`; without that, every file in it violates the package's own documented layout.

### `apps/backend` — the implementation (Tasks 8–13)

| Path | Responsibility |
|---|---|
| `src/db/migrations/*.ts` | Roles and default privileges first, then the seven tables |
| `src/db/data-source.ts` | **Modified** — connects as the schema owner (migrations only) |
| `src/app.module.ts` | **Modified** — runtime connects as the restricted app role |
| `src/users/` | `UserEntity`, `UsersService` (implements `IUserService`), controller, DTOs |
| `src/identities/` | `AuthIdentityEntity`, `IdentitiesService`, controller, the password hasher port |
| `src/auth/` | `AuthService`, controller, refresh-token rotation, guards, decorators, strategies |
| `src/audit/` | `AuditEntryEntity`, `AuditService` (implements `IAuditService`), controller |
| `src/mail/` | `IMailer` port + the dev adapter that writes messages to disk |
| `src/common/` | **Modified** — `@Public()` decorator, the global guard registration |

### `apps/webapp` — the same contracts over the wire (Tasks 15–18)

| Path | Responsibility |
|---|---|
| `app/fetchers/` | Thin request functions; the only place a URL is spelled |
| `app/services/` | `AuthHttpService`, `UserHttpService`, `IdentityHttpService` — implement the core contracts |
| `app/stores/auth.ts` | Access token in memory, current user, the re-mint lifecycle |
| `app/composables/` | `useAuth`, `useCurrentUser` |
| `app/middleware/` | `auth`, `guest` |
| `app/pages/` | login, register, verify-email, forgot/reset password, `account/*` |
| `app/components/{atoms,molecules,organisms}/` | The auth UI, each with a story |

### Forge's own tests (Tasks 18–19)

| Path | Responsibility |
|---|---|
| `tests/integration/generated-project.test.mjs` | **Modified** — inventory + the gate run over the new surface |
| `tests/integration/docker.test.mjs` | **Modified** — the identity e2e walk, D6/D7/D8/D13 against the real stack |

---

## Task index

| # | Task | Stage | Ships |
|---|---|---|---|
| 1 | Core subpath wiring | A | The mapping mechanism every later task's imports depend on |
| 2 | Shared primitives | A | `PaginatedResult`, `assertNever`, `normalizeEmail` |
| 3 | Platform ADRs 0005–0008 and the STANDARDS updates | A | The reasoning a generated project inherits |
| 4 | `users/` domain | B | `User`, `IUserService`, shared conformance suite |
| 5 | `identities/` domain | B | `AuthIdentity`, `IIdentityService`, password policy |
| 6 | `auth/` domain | B | `Session`, `AuthenticationOutcome`, `IAuthService` |
| 7 | `audit/` domain | B | `AuditEntry`, `IAuditService` |
| 8 | Persistence, the two roles, and the seven migrations | C | The schema, and D13's structural guarantee |
| 9 | Password hashing adapter | C | argon2id, rehash-on-login, proven inside the container |
| 10 | Mail port and dev adapter | C | ADR-0008 with no vendor binding |
| 11 | Registration, login and the session lifecycle | C | D6, D8 |
| 12 | Recovery, profile and platform administration | C | D7, DEC-4 |
| 13 | Backend conformance drivers and the security suite | C | D3 |
| 14 | Design system and the generic component library | D | A real starting point instead of one button |
| 15 | Webapp services and the shared conformance suite | D | The other half of DEC-1 |
| 16 | Auth store, composables, middleware and SSR re-mint | D | DEC-3 |
| 17 | Auth pages, components, stories and locale strings | D | The surface a user actually touches |
| 18 | Generated-project gates | E | Inventory, purity, sanitize, CI |
| 19 | Docker end-to-end identity walk | E | D6, D7, D8, D13 against the real stack |
| 20 | Fix wave, decision log, roadmap update | E | Phase 2 closed honestly |

---

## Endpoint ownership

Spec §9.7's Phase-2 rows, each assigned to exactly one task. Phase 1's most expensive defect class was two tasks each assuming the other owned something — ten dangling references, invisible to every vocabulary grep because the question was existence, not wording. An endpoint with no owner here is a gap in this plan, not a judgement call for whoever notices it.

| Endpoint | Task | Notes |
|---|---|---|
| `POST /auth/register` | 11 | `202` always, identical body either way |
| `POST /auth/verify-email` | 11 | consumes a single-use token in one transaction |
| `POST /auth/resend-verification` | 11 | `202` always, whether or not the address is known |
| `POST /auth/login` | 11 | sets the refresh cookie, returns the access token |
| `POST /auth/refresh` | 11 | rotation + reuse detection (D8) |
| `POST /auth/logout` | 11 | clears the cookie **and** revokes the session |
| `POST /auth/logout-all` | 11 | `IAuthService.revokeAllSessions` |
| `GET /users/me/sessions` | 11 | lives on the auth controller, not the users controller |
| `DELETE /users/me/sessions/:id` | 11 | |
| `POST /auth/forgot-password` | 12 | `202` always (D7) |
| `POST /auth/reset-password` | 12 | revokes every session |
| `PATCH /auth/change-password` | 12 | revokes every *other* session |
| `GET /users/me` | 12 | |
| `PATCH /users/me` | 12 | |
| `DELETE /users/me` | 12 | soft-deletes, revokes sessions, clears the cookie |
| `GET /users/me/identities` | 12 | |
| `DELETE /users/me/identities/:id` | 12 | calls core's `assertAtLeastOneIdentityRemains` |
| `GET /users`, `GET /users/:id` | 12 | platform admin (DEC-4) |
| `PATCH /users/:id/platform-role` | 12 | platform admin; cannot target oneself |
| `PATCH /users/:id/status` | 12 | platform admin; cannot target oneself |
| `GET /audit` | 12 | platform admin; org-scoped audit is Phase 3 |
| `GET /health` | — | ships in Phase 1; stays `@Public()` |

**Not in this phase:** `POST /users/me/identities/:provider` and the OAuth routes (Phase 4), every `/mfa/*` route (Phase 5), every `/organizations/*`, `/invitations/*` and grant route, and `GET /organizations/:id/audit` (Phase 3).

---

## Task 1: Core subpath wiring, and the two landmines it uncovers

Every import in Tasks 2–16 goes through this mechanism. It was probed empirically before this plan was written, in a real generated project, and the probe changed the answer twice — read the findings before you touch a file.

### What the probe established

**Six** places enumerate core's subpaths today, not four: `libs/core/package.json` `exports`, `libs/core/tsconfig.json` `paths` and `libs/core/jest.config.js` `moduleNameMapper` (core's own tests import through the public specifier), `apps/backend/tsconfig.json` `paths`, `apps/backend/jest.config.ts` `moduleNameMapper`, and `apps/webapp/vitest.config.ts` `resolve.alias`. Phase 2 adds ~24 subpaths, so hand-enumeration means ~144 lines kept in sync by hand.

**Five of the six become one wildcard line each. `exports` stays hand-enumerated, deliberately.**

The reason is the opposite of what it looks like. A wildcard `"./*"` in `exports` works — but it makes *every* subpath resolve from day one through the workspace symlink into `libs/core/dist`. A forgotten jest or vitest mapping then resolves silently to compiled output instead of source, and a suite can run green against a stale build. With `exports` enumerated, a new domain whose mapping you forgot fails loudly with `Cannot find module` until you add both. The probe demonstrated both halves of this: with mappings deleted and a deliberately stale `dist` in place, jest and vitest both read the stale compiled code and only went red because the assertion had been written to detect the swap. In ordinary code the assertion matches the old behaviour and the suite passes.

So: pay the enumeration tax in exactly one file, where it buys a loud failure. Take the wildcard in the four that resolve to source, where it cannot mask anything.

**Verified working** (Node 26 — see the caveat below): `exports` wildcard, backend `paths` wildcard spanning two segments across two different domains, jest `moduleNameMapper` with `$1`, and vitest's **array** alias form with a RegExp `find` (the object form cannot do this; `$1` does interpolate, and `fileURLToPath(new URL(...))` leaves it unencoded). `"./*/*"` is invalid — Node permits one `*` per pattern.

**Caveat, carried forward honestly:** only Node 26 is installed on this machine. `engines` pins `>=22 <23` and both Dockerfiles use `node:22-bookworm-slim`, so Node 22 is exercised for the first time in Task 19's Docker run. The `exports` semantics used here have been stable since Node 12, but **Node 22 is NOT VERIFIED on the host**. If Task 19 produces a resolution error, look here first.

### The two landmines

**L1 — `webapp:typecheck` fails on a clean checkout.** `nx.json` gives `dependsOn: ["^build"]` to `build` alone. `typecheck`, `test`, `lint` and `purity` have none. Backend typecheck, backend jest and webapp vitest all resolve to *source*, so they survive a missing `libs/core/dist`. Nuxt's typecheck does not: it resolves through `exports` and needs `dist/**/*.d.ts`. With core's `dist` deleted, `npx nuxt typecheck` exits 2. Phase 1 never saw this because the webapp imported nothing from core. It also means webapp typecheck reads possibly-stale `.d.ts`, which `dependsOn` fixes as a side effect.

**L2 — the backend's build output layout moves the first time a core import lands, breaking three shipped commands.** Pointing `paths` at core source lets that source into the backend's own compile; tsc's inferred common root then shifts from `apps/backend/src` to the workspace root, and `nest build` emits `dist/apps/backend/src/main.js` instead of `dist/main.js`. Not wildcard-specific — the enumerated form does it too.

> **Corrected during execution, from evidence.** This section originally said the `paths` *entry* causes the shift and prescribed rewriting the three commands to the drifted paths. That is wrong in a way that matters: the shift is caused by an **actual core import**, not by the mapping's presence. The template ships the mapping from this task but has no backend core import until Task 4, so rewriting the commands here would have made `npm run start:prod` fail with `MODULE_NOT_FOUND` for Tasks 1–3 — red-lining the generated project's own docker CI job and Forge's `FORGE_E2E` tier in the meantime. The implementer verified both states and fixed it properly instead: pin `"rootDir": "../.."` in `template/apps/backend/tsconfig.json`, which makes the emitted layout **identical with and without a core import**. The three commands then move once, here, and stay correct forever.

| File | Line | Now | Must become |
|---|---|---|---|
| `template/apps/backend/tsconfig.json` | `compilerOptions` | (no `rootDir`) | `"rootDir": "../.."` — pins the layout so it cannot drift |
| `template/apps/backend/package.json` | `"start:prod"` | `node dist/main` | `node dist/apps/backend/src/main` |
| `template/apps/backend/package.json` | `"migration:run:prod"` | `-d dist/db/data-source.js` | `-d dist/apps/backend/src/db/data-source.js` |
| `template/apps/backend/Dockerfile` | prod stage `CMD` | `["node", "dist/main"]` | `["node", "dist/apps/backend/src/main"]` |

The source project already carries the drifted command form (`node dist/apps/backend/src/main`); the template does not, because it never had a core import to trigger it. Nothing fails at typecheck or test time — it fails when the production image starts, which is the worst place to find it.

A consequence worth stating plainly, because it will confuse someone later — and which this plan got **wrong** at first, so read it carefully:

- **At compile and test time** the backend does not consume core's `dist`. Its `moduleResolution: "node"` ignores `exports` entirely, and `paths` points at source.
- **At runtime it does.** TypeScript does not rewrite a path-mapped specifier, so the emitted JavaScript still says `require("__FORGE_SCOPE__/core/...")`, and Node resolves that through the workspace symlink into `libs/core/dist`. The compiled copy of core that the `rootDir` pin emits under `apps/backend/dist/libs/` is never loaded — it is dead weight, and mistaking it for the thing that loads is exactly the error that produced the original claim here.

The consequence that matters: **any image running the backend must ship `libs/core/package.json` and `libs/core/dist`**, or the first core import dies at container start with `MODULE_NOT_FOUND`. The prod stage of `template/apps/backend/Dockerfile` copies both, and a container was watched failing without them before the fix was applied.

**Files:**
- Modify: `template/nx.json` (L1)
- Modify: `template/apps/backend/package.json` (L2, two scripts)
- Modify: `template/apps/backend/Dockerfile` (L2, prod `CMD`)
- Modify: `template/apps/backend/tsconfig.json` (wildcard `paths`)
- Modify: `template/apps/backend/jest.config.ts` (wildcard `moduleNameMapper`)
- Modify: `template/apps/webapp/vitest.config.ts` (array alias form)
- Modify: `template/libs/core/tsconfig.json` (wildcard self-`paths`)
- Modify: `template/libs/core/jest.config.js` (wildcard self-`moduleNameMapper`)
- `template/libs/core/package.json` is **not** touched here — Task 2 adds `./shared/policies` when it creates that folder, and every later task adds its own subpaths. This task establishes the mechanism, not its first use.

**Interfaces:**
- Consumes: nothing.
- Produces: the rule every later task follows — *add your new subpath to `libs/core/package.json` `exports` and nowhere else.* Tasks 2 and 4–7 each own one `exports` edit and no mapping edits.

- [ ] **Step 1: Fix L1 in `template/nx.json`**

```json
"typecheck": { "cache": true, "dependsOn": ["^build"] },
```

Leave `test`, `lint` and `purity` alone: they resolve to source and adding a build dependency to them would make every test run wait on a compile for no benefit.

- [ ] **Step 2: Fix L2 in the two backend files**

Apply the three replacements in the table above verbatim.

- [ ] **Step 3: Replace the four enumerations with wildcards**

`template/apps/backend/tsconfig.json` — `paths` becomes:

```json
"paths": {
  "@/*": ["src/*"],
  "__FORGE_SCOPE__/core/*": ["../../libs/core/src/*/index"]
}
```

`template/apps/backend/jest.config.ts` — `moduleNameMapper` becomes:

```ts
moduleNameMapper: {
  // Resolve core to SOURCE, not to its compiled output: a test that reads
  // `dist/` passes against whatever was last built, which can be anything.
  '^__FORGE_SCOPE__/core/(.*)$': '<rootDir>/../../../libs/core/src/$1/index.ts',
  '^@/(.*)$': '<rootDir>/$1',
},
```

(`rootDir` is `src`, so three levels up is the workspace root.)

`template/apps/webapp/vitest.config.ts` — `resolve.alias` must change from the object form to the **array** form; the object form cannot express a capture:

```ts
resolve: {
  alias: [
    // Must come first. Vite requires the character after a bare alias to be `/`,
    // so `@` does not swallow `__FORGE_SCOPE__/...` — but order it defensively anyway.
    {
      find: /^__FORGE_SCOPE__\/core\/(.*)$/,
      replacement: fileURLToPath(new URL('../../libs/core/src/$1/index.ts', import.meta.url)),
    },
    { find: '~', replacement: fileURLToPath(new URL('./app', import.meta.url)) },
    { find: '@', replacement: fileURLToPath(new URL('./app', import.meta.url)) },
  ],
},
```

`template/libs/core/tsconfig.json` — `paths` becomes `{ "__FORGE_SCOPE__/core/*": ["./src/*/index.ts"] }`.

`template/libs/core/jest.config.js` — `moduleNameMapper` becomes `{ '^__FORGE_SCOPE__/core/(.*)$': '<rootDir>/src/$1/index.ts' }`.

- [ ] **Step 4: Verify all five against a real generated project**

```bash
cd /Users/sinisimattia/Progetti/forge
OUT="$(mktemp -d)"
node tools/create/index.mjs --name probeapp --out "$OUT" --no-git --yes
cd "$OUT/probeapp"
npm ci
```

Create two throwaway domains — **two different domain names and two different folder names**, because a single one cannot distinguish a working two-segment wildcard from a one-segment special case:

- `libs/core/src/probeone/contracts/{IProbeService.ts,index.ts}` exporting a const marker
- `libs/core/src/probetwo/entities/{Probe.ts,index.ts}` exporting a class

Add `"./probeone/contracts"` and `"./probetwo/entities"` to `libs/core/package.json` `exports`. Then import them from a backend service, a backend `.spec.ts`, and a webapp `app/**/*.spec.ts`, and run each gate. Record the verbatim output of each.

- [ ] **Step 5: Prove each mapping discriminates**

For each of the four wildcard mappings: delete it, run its gate, **observe the failure**, restore it, observe the pass. Record all eight observations. The expected failures:

- backend `paths` removed → `error TS2307: Cannot find module '@probeapp/core/probeone/contracts'`
- backend jest mapper removed → `Cannot find module '@probeapp/core/probeone/contracts' from 'probe.service.spec.ts'`
- webapp vitest alias removed → `Failed to resolve import ... Plugin: vite:import-analysis`
- core self-`paths` removed → TS2307 in core's own tests

These are the failures **only while `libs/core/dist` is absent**. Delete `libs/core/dist` before this step, and say in your report that you did.

- [ ] **Step 6: Watch the stale-dist mask, so you know what you are trading**

This is the step that justifies keeping `exports` enumerated, and it is the one worth doing carefully.

1. `npx nx build core`, then edit a marker in `libs/core/src/probetwo/entities/Probe.ts` to a new value **without rebuilding**. `dist` is now stale.
2. Delete the webapp's vitest core alias. Run the webapp spec. **Observe that the import still resolves** — through the symlink and `exports` — and returns the *old* marker.
3. Now temporarily switch `exports` to the wildcard `"./*"` and remove `"./probetwo/entities"` from the enumeration. Confirm it still resolves.
4. Restore the enumerated `exports` and remove `"./probetwo/entities"` from it. Confirm the import now fails **loudly**.

Report all four observations. Step 4 is the behaviour being bought; steps 2 and 3 are the behaviour being avoided.

- [ ] **Step 7: Confirm L1 and L2 are really fixed**

```bash
rm -rf libs/core/dist
npx nx typecheck webapp          # must pass now — it triggers core's build via dependsOn
npx nx build backend
ls apps/backend/dist/apps/backend/src/main.js    # the drifted layout the scripts now expect
node -e "require('./apps/backend/dist/apps/backend/src/main.js')" 2>&1 | head -3
```

The last command will fail on a missing database connection — that is fine and expected. What is being checked is that the file **exists at the path `start:prod` names**, which is the thing L2 breaks.

- [ ] **Step 8: Remove the probe domains, sanitize, commit**

Delete `probeone`/`probetwo` from the generated project (they never existed in `template/`), remove the temp directory, and confirm `git status` in `/Users/sinisimattia/Progetti/forge` shows only the intended template files.

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/nx.json template/apps/backend/tsconfig.json template/apps/backend/jest.config.ts template/apps/backend/package.json template/apps/backend/Dockerfile template/apps/webapp/vitest.config.ts template/libs/core/tsconfig.json template/libs/core/jest.config.js template/libs/core/package.json
git commit -m "build(template): wildcard the core subpath mappings and fix the build-order and dist-layout landmines"
```

Report `git -C ~/Progetti/Voku status --porcelain` and `rev-parse --short HEAD` — this task reads the source project for the drifted `start:prod` form.

---

## Task 2: Shared primitives

The three cross-domain pieces every later core task imports. Small on purpose: this task exists so that Tasks 4–7 never have to invent a pagination shape, an exhaustiveness helper, or a second definition of what makes two email addresses the same identity.

**Files:**
- Create: `template/libs/core/src/shared/types/PaginatedResult.ts`
- Create: `template/libs/core/src/shared/policies/assertNever.ts`
- Create: `template/libs/core/src/shared/policies/normalizeEmail.ts`
- Create: `template/libs/core/src/shared/policies/index.ts`
- Modify: `template/libs/core/src/shared/types/index.ts`
- Modify: `template/libs/core/STANDARDS.md` (sanction the `policies/` folder — see Step 4)
- Modify: `template/libs/core/package.json` (add the `./shared/policies` export)
- Modify: `template/libs/core/tsconfig.json`, `template/libs/core/jest.config.js` (add `./shared/policies` — see Task 1 for the mapping form)
- Test: `template/libs/core/tests/shared/policies/assertNever.spec.ts`
- Test: `template/libs/core/tests/shared/policies/normalizeEmail.spec.ts`

**Interfaces:**
- Consumes: the subpath mapping mechanism from Task 1; `Brand` from `shared/types` (already shipped).
- Produces:
  - `PaginatedResult<T>` — `{ data: T[]; meta: { total, page, limit, totalPages } }`. Tasks 4, 7, 12 and 13 return it.
  - `assertNever(value: never): never` — throws. Every `switch` over a discriminated union in core and in both apps ends with `default: return assertNever(x)`.
  - `normalizeEmail(raw: string): string` — trims and lowercases. Tasks 4, 5, 6, 11 and 12 all call it; nothing anywhere else may define email equality.

- [ ] **Step 1: Write the failing tests**

`template/libs/core/tests/shared/policies/assertNever.spec.ts`:

```ts
import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';

describe('assertNever', () => {
  it('throws, naming the value that escaped the switch', () => {
    expect(() => assertNever('UNHANDLED' as never)).toThrow(/UNHANDLED/);
  });

  it('is reachable only through a cast, which is the point', () => {
    // A union with every branch handled leaves `never` at the default, so this
    // compiles. Adding a branch to the union makes the argument no longer `never`
    // and turns this into a compile error at every call site — the reason the
    // helper exists.
    type Status = 'A' | 'B';
    const describeStatus = (status: Status): string => {
      switch (status) {
        case 'A':
          return 'a';
        case 'B':
          return 'b';
        default:
          return assertNever(status);
      }
    };
    expect(describeStatus('A')).toBe('a');
    expect(describeStatus('B')).toBe('b');
  });
});
```

`template/libs/core/tests/shared/policies/normalizeEmail.spec.ts`:

```ts
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';

describe('normalizeEmail', () => {
  it('lowercases and trims, so two spellings are one identity', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('leaves an already-normal address untouched', () => {
    expect(normalizeEmail('ada@example.com')).toBe('ada@example.com');
  });

  it('does not strip internal whitespace, which would silently accept a typo', () => {
    expect(normalizeEmail('ada @example.com')).toBe('ada @example.com');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Generate a project first if you do not have one (`node tools/create/index.mjs --name probeapp --out "$(mktemp -d)" --no-git --yes`), or work in `template/` and rely on Task 18's gate. Inside the generated project:

Run: `npx nx test core`
Expected: FAIL — `Cannot find module '@probeapp/core/shared/policies'`.

- [ ] **Step 3: Write the implementations**

`template/libs/core/src/shared/types/PaginatedResult.ts`:

```ts
/**
 * A page of `T` returned by a paginated contract method, alongside the metadata
 * a caller needs to render pagination controls and request further pages.
 */
export interface PaginatedResult<T> {
  data: T[];
  meta: {
    /** Total matching records, not the length of `data`. */
    total: number;
    /** 1-based page number. */
    page: number;
    /** Maximum records per page. */
    limit: number;
    /** `Math.ceil(total / limit)`; 0 when `total` is 0. */
    totalPages: number;
  };
}
```

`template/libs/core/src/shared/policies/assertNever.ts`:

```ts
/**
 * Exhaustiveness guard for a discriminated union.
 *
 * Used as the `default` of a `switch`, it is reachable only when the union has
 * grown a branch the switch does not handle — which the compiler reports as an
 * error at the call site, before the code ever runs. The throw is the runtime
 * backstop for a value that arrived from outside the type system.
 *
 * @param value - the branch that was not handled
 * @throws always
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
```

`template/libs/core/src/shared/policies/normalizeEmail.ts`:

```ts
/**
 * The single definition of email identity in the domain.
 *
 * Two addresses are the same account when their normal forms are equal. Only
 * surrounding whitespace and letter case are normalized: the local part of an
 * address is case-sensitive by specification, but no provider in practice
 * treats it that way, and folding case here is what stops one person holding
 * two accounts that look identical. Anything more aggressive — stripping dots,
 * removing `+tags` — is provider-specific and would silently merge addresses
 * that are genuinely distinct elsewhere.
 *
 * @param raw - an address as a person typed it
 * @returns the normal form used for storage, lookup and uniqueness
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
```

`template/libs/core/src/shared/policies/index.ts`:

```ts
export * from './assertNever';
export * from './normalizeEmail';
```

`template/libs/core/src/shared/types/index.ts` — add the new export alongside the existing `Brand` line:

```ts
export type { Brand } from './Brand';
export type { PaginatedResult } from './PaginatedResult';
```

- [ ] **Step 4: Sanction `policies/` in the package's own standards, then wire the subpath**

`libs/core/STANDARDS.md`'s layout table currently says each domain folder has **exactly six**
subfolders, and lists `shared/` as `errors/`, `testing/` and `types/`. This task creates a
seventh, so it must license it in the same commit — otherwise every file it adds violates the
standard the package ships, and a reviewer would be right to reject it.

Make three edits, and no more (Task 3 owns the rest of this file):

1. Change "exactly six subfolders" to "exactly seven" and add the table row:

```markdown
| `policies/` | **Pure functions** over entities, enums and types — the only place in core a standalone function may live (e.g. `normalizeEmail.ts`, `assertNever.ts`, later `can.ts`) | classes, interfaces, state, anything with a dependency |
```

2. Add `shared/policies/` to the `shared/` bullet list.
3. Add `/<domain>/policies` to the "Subpath exports only" list.

One sentence of rationale in the file: a domain rule that is not a method on an entity — because
it spans entities, or because it must be callable without constructing one — has nowhere else to
live, and hiding it as a static method on a class with no instances is worse.

Then add `./shared/policies` to `template/libs/core/package.json` `exports`, to `template/libs/core/tsconfig.json` `paths` and to `template/libs/core/jest.config.js` `moduleNameMapper`, in whichever form Task 1 established. `shared/types` already exists in all three and needs no change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx nx test core`
Expected: PASS, and coverage still at 100% for statements, branches, functions and lines. `PaginatedResult` is a `types/` interface and is excluded from coverage by config; both policy functions are executable and must be fully covered by the specs above.

- [ ] **Step 6: Verify purity is still clean**

Run: `npm run purity -w libs/core` and `npx nx lint core`
Expected: `libs/core purity: clean`, and lint passes.

Read the three new files once more against the forbidden-substring list before moving on. `normalizeEmail`'s TSDoc talks about addresses and providers; if you find yourself wanting to write "the HTTP layer" or "the JWT subject", that is the rule doing its job — rewrite the sentence in domain terms.

- [ ] **Step 7: Sanitize and commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/libs/core/src/shared template/libs/core/tests/shared template/libs/core/package.json template/libs/core/tsconfig.json template/libs/core/jest.config.js
git commit -m "feat(core): add the shared primitives the identity domains build on"
```

---

## Task 3: Platform ADRs 0005–0008 and the STANDARDS updates

Spec §8.2 says a generated project ships platform ADRs 0005–0008. It does not — `template/docs/adrs/` holds 0000–0004. Every design decision Tasks 4–16 depend on is currently undocumented in the artifact that is supposed to carry it, and a generated project would inherit the code without the reasoning. This task closes that, and makes the two layout changes Phase 2 needs to the packages' own standards.

**Files:**
- Create: `template/docs/adrs/0005-identity-is-separate-from-user.md`
- Create: `template/docs/adrs/0006-authorization-is-a-pure-function-in-core.md`
- Create: `template/docs/adrs/0007-tenancy-is-explicit-never-ambient.md`
- Create: `template/docs/adrs/0008-ports-not-vendors.md`
- Modify: `template/docs/adrs/README.md` (the index)
- Modify: `template/libs/core/STANDARDS.md` (the `policies/` folder; two new review dimensions)
- Modify: `template/apps/backend/STANDARDS.md` (three new review dimensions)
- Modify: `template/tools/../..` — none.

**Interfaces:**
- Consumes: the ADR format in `template/docs/adrs/0000-template.md`; the four convention ADRs 0001–0004 as tone reference.
- Produces: ADR numbers 0005–0008, cited by name in Tasks 4, 5, 6, 8 and 10; the `policies/` folder rule that Task 2's files already depend on; review dimensions K7, K8, B8, B9, B10 that the `reviewer` agent discovers per package.

- [ ] **Step 1: Read the existing ADRs before writing a word**

```bash
cat template/docs/adrs/0000-template.md
cat template/docs/adrs/0003-architecture-docs-describe-boundaries.md
sed -n '/## Review dimensions/,$p' template/libs/core/STANDARDS.md
```

Match the existing structure exactly. Phase 1's reviewer verified that ADR-0002 "connects its decision to its real price" — an ADR that records a decision without its cost is half an ADR. Each of these four must state what it costs, not only what it buys.

ADR-0005, -0006 and -0007 are restatements of spec §9.1 in the template's voice, with one addition each that §9.1 does not spell out:

- **0005 — Identity is separate from user.** Cost to record: two tables and a join on the hottest path in the system, plus an `AuthIdentity` row that exists for a password account where a column on `users` would have done. Why it is paid now rather than later: adding a provider in Phase 4 is an insert; retrofitting the split is a migration of every account in every generated project. Add the consequence Phase 2 actually relies on: the core `AuthIdentity` entity carries **no secret material**, so a hash cannot leak into a wire shape that has no field for it.
- **0006 — Authorization is a pure function in core.** Phase 3 implements it; the ADR ships now because Phase 2's `platformRole` is the first layer of the three-layer model and `PLATFORM_ADMIN` passing everything is already true in Task 12. Cost: the webapp can compute a decision the server has not blessed, so the rule "the server enforces, the client only predicts" has to be stated and held.
- **0007 — Tenancy is explicit, never ambient.** No organization exists until Phase 3. It ships now because Phase 2 creates the audit log with a nullable `organizationId`, and the temptation to resolve "the current org" from ambient state arrives with the first tenant-scoped query. Cost: every tenant-scoped signature carries an `organizationId` parameter forever, including ones where it feels redundant.
- **0008 — Ports, not vendors.** Task 10 is its first instance. Cost: the shipped mail adapter cannot send an email, so a generated project's verification link is read off disk until someone binds a provider — deliberately, because the alternative is a template that carries somebody's account.

- [ ] **Step 2: Write the four ADRs and update the index**

Use `0000-template.md`'s section structure. Status for all four: `Accepted`. Date: the date you write them. Cross-reference each to the spec section it comes from and to the tasks that implement it.

`template/docs/adrs/README.md` currently indexes five ADRs; extend the table with the four new rows in number order. Do not restructure the file.

- [ ] **Step 3: Verify every link resolves**

```bash
cd /Users/sinisimattia/Progetti/forge/template
grep -rnoE '\]\([^)]+\.md[^)]*\)' docs/adrs/000[5-8]*.md docs/adrs/README.md | sed 's/.*(\(.*\))/\1/' | sort -u
```

Resolve each hit by hand against the real tree. Phase 1 shipped four dangling pointers to `docs/architecture/{system-overview,backend,frontend}.md` and the class was invisible to vocabulary greps — it is about file existence, not wording. Any link to a file that does not exist is a defect in this task, not a future one.

- [ ] **Step 4: Verify the `policies/` folder is already sanctioned**

Task 2 added the `policies/` row to `libs/core/STANDARDS.md`'s layout table, changed "exactly six subfolders" to seven, and extended the `shared/` bullet and the subpath list — it had to, because it created the folder. Confirm all three edits are present and correct; do **not** re-add them. If any is missing, add it here and note the gap in your report.

- [ ] **Step 5: Add the new review dimensions**

Append to `template/libs/core/STANDARDS.md`'s `## Review dimensions` table:

```markdown
| K7 | A contract that can reject exposes *why* to the server, never to a caller it does not trust | review `src/*/contracts/*.ts` and `src/*/types/*Outcome.ts`: a rejection reason may be recorded and audited, and must not appear in a JSON wire shape used on an authentication path | blocking | ADR-0005, spec §9.3 — identical responses |
| K8 | Every `switch` over a discriminated union ends in `assertNever` | `grep -rn "switch (" src/ \| ` then read each: a `switch` over a union type with no `default: return assertNever(...)` is a violation | blocking | STANDARDS.md — exhaustiveness |
```

Append to `template/apps/backend/STANDARDS.md`'s `## Review dimensions` table:

```markdown
| B8 | Every route is authenticated unless it explicitly opts out | `grep -rn "@Public()" src/ --include=*.controller.ts` — every hit must be a route that genuinely needs anonymous access (login, register, verification, password reset, health) | blocking | spec §9.5 — global guard with explicit opt-out |
| B9 | Secret material never reaches a response | `grep -rniE "hash\|secret\|token" src/**/dto/*.ts` — a response DTO carrying any of them is a violation unless it is a single-use credential the caller just asked to be issued | blocking | ADR-0005 — identities carry no secret material |
| B10 | A state change worth reconstructing later is audited | a changed `*.service.ts` method that writes and does not call `IAuditService.record()` | warning | spec §9.6 — audit coverage |
```

- [ ] **Step 6: Verify the reviewer contract still holds**

Each `Signal` must be executable and must actually fire. Construct a synthetic violation for **K8, B8 and B9** and confirm the grep reports it; K7 and B10 are read-and-judge rows and must say so rather than pretending to be greppable.

Phase 1's Task 12 found four of eight webapp signals had confirmed false negatives — a row whose signal cannot fire is worse than no row, because it buys false confidence. Report, for each of the five new rows, either the command plus its verbatim output against a violation you constructed, or an explicit "this row cannot be grepped; the reviewer must read the file".

- [ ] **Step 7: Sanitize and commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/docs/adrs template/libs/core/STANDARDS.md template/apps/backend/STANDARDS.md
git commit -m "docs(template): add the platform ADRs and the standards Phase 2 depends on"
```

---

## Task 4: The `users/` domain

The first real domain in `libs/core`, and the template for the three that follow. It also settles a question the spec leaves open and that every later contract inherits: **who the caller is, is an explicit parameter.**

Every contract method in this phase takes the acting user's id as its first argument. This is ADR-0007's rule ("explicit, never ambient") applied to the actor rather than the tenant, and it is what makes the same contract implementable by both apps: the backend resolves the actor from its own request context and passes it in; the webapp passes the id its store already holds. Neither reaches into ambient state inside the service.

**Not in this contract, deliberately:**
- `create()` — an account is created by registering, which is `IAuthService.register`. A second creation path that skips verification would be a way to mint a usable account without one.
- `findByEmail()` — a contract method that answers "does this address have an account" is an enumeration oracle. Address lookup exists inside the backend implementation and is reachable from no contract.
- `markEmailVerified()` — internal to the verification flow in Task 11; exposing it would let any caller verify any address.

**Files:**
- Create: `template/libs/core/src/users/entities/{User.ts,index.ts}`
- Create: `template/libs/core/src/users/enums/{UserStatus.ts,PlatformRole.ts,index.ts}`
- Create: `template/libs/core/src/users/errors/{EmailRequiredError.ts,InvalidEmailError.ts,DisplayNameRequiredError.ts,UserNotFoundError.ts,EmailAlreadyRegisteredError.ts,index.ts}`
- Create: `template/libs/core/src/users/types/{UserId.ts,UserJSON.ts,UserProps.ts,UpdateUserProfileInput.ts,UserQuery.ts,index.ts}`
- Create: `template/libs/core/src/users/contracts/{IUserService.ts,index.ts}`
- Create: `template/libs/core/src/users/testing/{IUserServiceContractDeps.ts,runIUserServiceContract.ts,user-fixtures.ts,index.ts}`
- Modify: `template/libs/core/package.json`, `tsconfig.json`, `jest.config.js` (six new subpaths)
- Test: `template/libs/core/tests/users/entities/User.spec.ts`
- Test: `template/libs/core/tests/users/testing/runIUserServiceContract.spec.ts`

**Interfaces:**
- Consumes: `DomainError` (`shared/errors`), `Brand` and `PaginatedResult` (`shared/types`), `normalizeEmail` (`shared/policies`), `ConformanceExpect` (`shared/testing`).
- Produces, used by Tasks 5, 6, 7, 11, 12, 13, 14:
  - `type UserId = Brand<string, 'UserId'>`
  - `enum UserStatus { ACTIVE, SUSPENDED }`
  - `enum PlatformRole { PLATFORM_ADMIN, PLATFORM_USER }`
  - `class User` with `id, email, displayName, status, platformRole, emailVerifiedAt, createdAt, updatedAt, deletedAt`, getters `isEmailVerified` / `isDeleted`, method `canAuthenticate(): boolean`, `toJSON(): UserJSON`, `static fromJSON(json: UserJSON): User`
  - `interface IUserService` — `getProfile`, `updateProfile`, `deleteAccount`, `listUsers`, `setStatus`, `setPlatformRole`
  - `runIUserServiceContract(deps: IUserServiceContractDeps): void`
  - `makeUserJSON(overrides?: Partial<UserJSON>): UserJSON` from `user-fixtures.ts`

- [ ] **Step 1: Write the enums and the branded id**

`template/libs/core/src/users/enums/UserStatus.ts`:

```ts
/**
 * Whether an account may be used at all.
 *
 * Deletion is not a status: a deleted account is one whose `deletedAt` is set,
 * so that "suspended and later restored" and "deleted" stay independent facts.
 * Verification is likewise not a status — it is `emailVerifiedAt` — because an
 * account can be suspended before or after it is verified.
 */
export enum UserStatus {
  /** Usable, subject to verification and deletion. */
  ACTIVE = 'ACTIVE',
  /** Blocked by an administrator. Retains all data; cannot authenticate. */
  SUSPENDED = 'SUSPENDED',
}
```

`template/libs/core/src/users/enums/PlatformRole.ts`:

```ts
/**
 * A person's standing with respect to the deployment itself, never with respect
 * to anything inside it. It is deliberately not an organization role: those are
 * per-organization and live on a membership, so that one person can hold
 * different roles in different organizations. Platform administration is not
 * implied by any organization role and never will be.
 */
export enum PlatformRole {
  /** May operate the deployment. Every use of this power is recorded. */
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
  /** Everyone else. The default for a newly registered account. */
  PLATFORM_USER = 'PLATFORM_USER',
}
```

`template/libs/core/src/users/types/UserId.ts`:

```ts
import type { Brand } from '../../shared/types/Brand';

/** A user's identifier. Branded so it cannot be passed where another id is expected. */
export type UserId = Brand<string, 'UserId'>;
```

Barrel each folder (`export * from './UserStatus';` and so on). `types/index.ts` uses `export type { ... }` — `verbatimModuleSyntax` is on.

- [ ] **Step 2: Write the errors**

Five files, each the same shape. `template/libs/core/src/users/errors/EmailAlreadyRegisteredError.ts`:

```ts
import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an account already exists for an address, in a context where the
 * caller is entitled to know — linking an identity to a signed-in account, for
 * instance. It is never surfaced on registration or password recovery, where
 * telling a stranger that an address is taken is an enumeration oracle.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super('An account already exists for that address.');
  }
}
```

The other four, with these messages:
- `EmailRequiredError` — `'An email address is required.'`
- `InvalidEmailError` — `` `"${value}" is not a usable email address.` `` (takes the offending value)
- `DisplayNameRequiredError` — `'A display name is required.'`
- `UserNotFoundError` — `` `No user with id "${id}".` `` (takes the id)

Note `DomainError`'s constructor is `protected`, so each subclass must declare a `public` constructor — that is what makes the base uninstantiable directly.

- [ ] **Step 3: Write the entity**

`template/libs/core/src/users/entities/User.ts`:

The constructor takes a **props object**, not positional parameters. This departs from the source project, which uses `public readonly` positional parameters — with nine fields, three of them nullable and two of them adjacent `Date | null`, a positional constructor makes a silent transposition possible, and the compiler cannot help. `UserProps` lives in `types/UserProps.ts`, one symbol per file (K6).

```ts
import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import { PlatformRole } from '../enums/PlatformRole';
import { UserStatus } from '../enums/UserStatus';
import { DisplayNameRequiredError } from '../errors/DisplayNameRequiredError';
import { EmailRequiredError } from '../errors/EmailRequiredError';
import { InvalidEmailError } from '../errors/InvalidEmailError';
import type { UserId } from '../types/UserId';
import type { UserJSON } from '../types/UserJSON';
import type { UserProps } from '../types/UserProps';

/**
 * A person. One `User` is one human being, independent of how many ways they
 * have of proving it — those are auth identities, and a user with none is
 * possible only transiently.
 *
 * The entity carries no secret material of any kind. That is structural rather
 * than careful: there is no field for a secret, so no serialization of a user
 * can leak one.
 */
export class User {
  readonly id: UserId;
  /** Normal form, per `normalizeEmail`. Two users can never differ only by case. */
  readonly email: string;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly platformRole: PlatformRole;
  /** When the address was proven, or `null` if it has not been. */
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set by a soft delete. The record is retained; the account is unusable. */
  readonly deletedAt: Date | null;

  constructor(props: UserProps) {
    const email = normalizeEmail(props.email);
    if (email === '') throw new EmailRequiredError();
    if (!User.looksLikeAnAddress(email)) throw new InvalidEmailError(props.email);
    if (props.displayName.trim() === '') throw new DisplayNameRequiredError();

    this.id = props.id;
    this.email = email;
    this.displayName = props.displayName.trim();
    this.status = props.status;
    this.platformRole = props.platformRole;
    this.emailVerifiedAt = props.emailVerifiedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.deletedAt = props.deletedAt;
  }

  /**
   * A deliberately shallow check: exactly one `@`, something either side, no
   * whitespace. Anything stricter rejects addresses that are legal and in use;
   * the only real proof that an address exists is that someone received a
   * message at it, which is what verification is for.
   */
  private static looksLikeAnAddress(value: string): boolean {
    const parts = value.split('@');
    return parts.length === 2 && parts[0] !== '' && parts[1] !== '' && !/\s/.test(value);
  }

  /** Whether the address has been proven. */
  get isEmailVerified(): boolean {
    return this.emailVerifiedAt !== null;
  }

  /** Whether the account has been soft-deleted. */
  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /**
   * Whether this account may be authenticated at all.
   *
   * All three conditions are load-bearing and each has its own failure mode:
   * an unverified account would let someone claim an address that is not
   * theirs, a suspended one would ignore an administrator's decision, and a
   * deleted one would resurrect an account its owner asked to be removed.
   */
  canAuthenticate(): boolean {
    return this.status === UserStatus.ACTIVE && this.isEmailVerified && !this.isDeleted;
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): UserJSON {
    return {
      id: this.id,
      email: this.email,
      displayName: this.displayName,
      status: this.status,
      platformRole: this.platformRole,
      emailVerifiedAt: this.emailVerifiedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      deletedAt: this.deletedAt?.toISOString() ?? null,
    };
  }

  /** Rebuilds a user from its wire shape, re-running every invariant. */
  static fromJSON(json: UserJSON): User {
    return new User({
      id: json.id,
      email: json.email,
      displayName: json.displayName,
      status: json.status,
      platformRole: json.platformRole,
      emailVerifiedAt: json.emailVerifiedAt === null ? null : new Date(json.emailVerifiedAt),
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
      deletedAt: json.deletedAt === null ? null : new Date(json.deletedAt),
    });
  }
}
```

`template/libs/core/src/users/types/UserJSON.ts` mirrors it with `string` instants and `UserId`/enum-typed fields, each member carrying TSDoc.

- [ ] **Step 4: Write the entity test and watch it fail, then pass**

`template/libs/core/tests/users/entities/User.spec.ts` — import from `__FORGE_SCOPE__/core/users/entities`, `/enums`, `/errors`, `/types`. Cover, at minimum:

```
constructor
  normalizes the address, so '  Ada@Example.COM ' and 'ada@example.com' are one identity
  trims the display name
  throws EmailRequiredError for '' and for '   '
  throws InvalidEmailError for 'ada', 'ada@', '@example.com', 'a@b@c', 'ada @example.com'
  throws DisplayNameRequiredError for '  '
isEmailVerified / isDeleted
  false when the instant is null, true when it is set
canAuthenticate
  true for an active, verified, undeleted user
  false when unverified          (verification missing)
  false when SUSPENDED           (administrator's decision)
  false when deletedAt is set    (owner's decision)
toJSON / fromJSON
  round-trips, and every instant survives as an equal Date
  preserves null emailVerifiedAt and null deletedAt
  re-runs invariants: fromJSON with displayName '' throws
```

Run `npx nx test core` before writing `User.ts` and confirm the failure is a missing module, then again after and confirm 100% coverage of the new file. Report the coverage table, not a summary of it.

- [ ] **Step 5: Write the contract**

`template/libs/core/src/users/contracts/IUserService.ts`:

```ts
import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import type { User } from '../entities/User';
import type { PlatformRole } from '../enums/PlatformRole';
import type { UserStatus } from '../enums/UserStatus';
import type { UpdateUserProfileInput } from '../types/UpdateUserProfileInput';
import type { UserId } from '../types/UserId';
import type { UserQuery } from '../types/UserQuery';

/**
 * Reading and administering people.
 *
 * Every method takes `actorId` — the user on whose behalf the call is made —
 * as its first parameter. Nothing is resolved from ambient state: an
 * implementation that decided for itself who was calling would be impossible
 * to reason about and impossible to test, and the same reasoning that keeps
 * tenancy explicit keeps the actor explicit (ADR-0007).
 *
 * Creating an account is not here: an account comes into being by registering
 * (`IAuthService.register`), which is the only path that also establishes how
 * the person will prove who they are.
 */
export interface IUserService {
  /**
   * The profile of `targetId`.
   *
   * A user may read their own profile; a platform administrator may read any.
   * @throws UserNotFoundError when no such user exists, and when the actor is
   * not entitled to it — the two are indistinguishable on purpose, so that
   * probing for ids reveals nothing.
   */
  getProfile(actorId: UserId, targetId: UserId): Promise<User>;

  /** Updates the actor's own profile. There is no path to another user's. */
  updateProfile(actorId: UserId, input: UpdateUserProfileInput): Promise<User>;

  /**
   * Soft-deletes the actor's own account and ends every session it holds.
   * The record remains so that history referencing it stays readable.
   */
  deleteAccount(actorId: UserId): Promise<void>;

  /** Lists accounts. Platform administrators only. */
  listUsers(actorId: UserId, query: UserQuery): Promise<PaginatedResult<User>>;

  /** Suspends or reinstates an account. Platform administrators only. */
  setStatus(actorId: UserId, targetId: UserId, status: UserStatus): Promise<User>;

  /** Grants or withdraws platform administration. Platform administrators only. */
  setPlatformRole(actorId: UserId, targetId: UserId, role: PlatformRole): Promise<User>;
}
```

`UpdateUserProfileInput` is `{ displayName?: string }` for now. `UserQuery` is `{ page: number; limit: number; search?: string }`.

- [ ] **Step 6: Write the shared conformance suite**

`template/libs/core/src/users/testing/IUserServiceContractDeps.ts`:

```ts
import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { IUserService } from '../contracts/IUserService';
import type { User } from '../entities/User';

/** One isolated world, built fresh for each test. */
export interface UserServiceContractContext {
  service: IUserService;
  /** An ordinary, active, verified user. */
  actor: User;
  /** A second ordinary user, so a test can prove one person's data is not another's. */
  other: User;
  /** A platform administrator. */
  admin: User;
}

/** Runner primitives + the world factory the shared suite needs. */
export interface IUserServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly the three users it returns. */
  makeContext: () => Promise<UserServiceContractContext>;
}
```

`runIUserServiceContract.ts` asserts exactly this list, and nothing about authorization (that is the backend-only suite in Task 13):

```
getProfile
  returns the actor's own profile
  returns a profile whose email is in normal form
  rejects UserNotFoundError for an id that does not exist
updateProfile
  changes the display name and returns the updated user
  trims the new display name
  rejects DisplayNameRequiredError for a blank display name
  leaves the email untouched — a profile update is not an address change
deleteAccount
  marks the account deleted: a subsequent getProfile shows isDeleted
  makes canAuthenticate() false
listUsers
  returns a PaginatedResult whose meta.total counts matches and whose
    meta.totalPages is ceil(total / limit)
  returns page 2 disjoint from page 1
setStatus / setPlatformRole
  SUSPENDED makes canAuthenticate() false for a verified user
  reinstating to ACTIVE makes it true again
  granting PLATFORM_ADMIN is reflected in a later getProfile
wire shape
  User.fromJSON(user.toJSON()) equals the original in every field
```

The last one is the assertion that actually earns DEC-1: it is the one place the two implementations are proven to agree on the shape crossing between them.

- [ ] **Step 7: Self-test the suite against an in-memory reference implementation**

`template/libs/core/tests/users/testing/runIUserServiceContract.spec.ts` implements `IUserService` over a `Map`, in the test file, and drives `runIUserServiceContract` with jest's `describe`/`it`/`expect`. This is what gives `runIUserServiceContract.ts` its coverage and — more importantly — proves the suite is satisfiable before any app tries to satisfy it.

Run: `npx nx test core`
Expected: PASS, coverage 100%.

- [ ] **Step 8: Prove the suite discriminates (D3)**

This is the phase's first instance of "a guard nobody has watched fail is not a guard".

1. In the in-memory reference implementation, break `updateProfile` so it does not trim the display name. Run `npx nx test core`. **Observe the failure** and record the verbatim output.
2. Restore it, and instead delete the trimming assertion from `runIUserServiceContract.ts`. Run again, with the broken implementation restored. **Observe that it now passes** — which is the point: a suite with a missing assertion is indistinguishable from a correct implementation.
3. Restore both. Confirm green.

Report all three observations. Step 2 is the one that matters and is the one most likely to be skipped.

- [ ] **Step 9: Purity, lint, sanitize, commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/libs/core/src/users template/libs/core/tests/users template/libs/core/package.json template/libs/core/tsconfig.json template/libs/core/jest.config.js
git commit -m "feat(core): add the users domain and its conformance suite"
```

Before committing, run `npm run purity -w libs/core` and `npx nx lint core` inside a generated project and paste the output. Both must be clean. Re-read every TSDoc line you wrote against the forbidden-substring list — this task writes more prose than any before it, and `http`, `cookie` and `jwt` are all natural words to reach for when describing sessions and addresses.

---

## Task 5: The `identities/` domain

Roadmap ordering decision 1, made real. Password is not "the" way to log in; it is the `PASSWORD` provider, and the table that says so exists from the first migration. Phase 4 then adds a provider by inserting a row, not by migrating every account in every generated project.

**Files:**
- Create: `template/libs/core/src/identities/entities/{AuthIdentity.ts,index.ts}`
- Create: `template/libs/core/src/identities/enums/{AuthProvider.ts,index.ts}`
- Create: `template/libs/core/src/identities/errors/{LastIdentityRemovalError.ts,IdentityNotFoundError.ts,IdentityAlreadyLinkedError.ts,IdentityAccountIdRequiredError.ts,WeakPasswordError.ts,index.ts}`
- Create: `template/libs/core/src/identities/types/{AuthIdentityId.ts,AuthIdentityJSON.ts,PasswordPolicy.ts,PasswordPolicyViolation.ts,index.ts}`
- Create: `template/libs/core/src/identities/policies/{assertAtLeastOneIdentityRemains.ts,evaluatePassword.ts,index.ts}`
- Create: `template/libs/core/src/identities/contracts/{IIdentityService.ts,IBreachedPasswordRegistry.ts,index.ts}`
- Create: `template/libs/core/src/identities/testing/{IIdentityServiceContractDeps.ts,runIIdentityServiceContract.ts,identity-fixtures.ts,index.ts}`
- Modify: `template/libs/core/package.json`, `tsconfig.json`, `jest.config.js`
- Test: `template/libs/core/tests/identities/entities/AuthIdentity.spec.ts`
- Test: `template/libs/core/tests/identities/policies/{assertAtLeastOneIdentityRemains.spec.ts,evaluatePassword.spec.ts}`
- Test: `template/libs/core/tests/identities/testing/runIIdentityServiceContract.spec.ts`

**Interfaces:**
- Consumes: `UserId` (`users/types`), `DomainError`, `Brand`, `normalizeEmail`.
- Produces:
  - `enum AuthProvider { PASSWORD, GOOGLE, GITHUB, OIDC }`
  - `class AuthIdentity` — `id, userId, provider, providerAccountId, createdAt, lastUsedAt`
  - `assertAtLeastOneIdentityRemains(identities: AuthIdentity[], removingId: AuthIdentityId): void`
  - `evaluatePassword(secret: string, policy: PasswordPolicy): PasswordPolicyViolation[]`
  - `DEFAULT_PASSWORD_POLICY: PasswordPolicy`
  - `interface IIdentityService` — `listIdentities`, `unlinkIdentity`
  - `interface IBreachedPasswordRegistry` — `isKnownBreached(secret: string): Promise<boolean>`
  - `runIIdentityServiceContract(deps): void`

- [ ] **Step 1: Write the provider enum and the entity**

`AuthProvider` ships all four members now, with only `PASSWORD` implemented:

```ts
/**
 * A way of proving you are a particular person.
 *
 * All four members exist from the start even though only {@link AuthProvider.PASSWORD}
 * is implemented in this phase. The alternative — adding members later — would
 * mean a stored value changing meaning, and every persisted identity being
 * rewritten. A provider that is not configured is simply one that no identity
 * refers to.
 */
export enum AuthProvider {
  /** A secret only the person knows, verified against a stored derivation of it. */
  PASSWORD = 'PASSWORD',
  GOOGLE = 'GOOGLE',
  GITHUB = 'GITHUB',
  /** Any other provider reached through the generic protocol adapter. */
  OIDC = 'OIDC',
}
```

`AuthIdentity` carries **no secret material** — no hash, no salt, no parameters:

```ts
/**
 * One way a particular user can prove who they are.
 *
 * Deliberately empty of secret material. The derivation of a password lives
 * beside the record that stores it and is never part of this entity, so no
 * serialization of an identity can leak one: there is no field for it. A
 * caller that needs to *verify* a secret does not need to see it, which is why
 * verification is a capability of the implementation rather than a property of
 * the entity (ADR-0005).
 */
export class AuthIdentity {
  readonly id: AuthIdentityId;
  readonly userId: UserId;
  readonly provider: AuthProvider;
  /**
   * How this provider names the account: the normal-form address for
   * {@link AuthProvider.PASSWORD}, the provider's own subject identifier
   * otherwise. Unique per provider.
   */
  readonly providerAccountId: string;
  readonly createdAt: Date;
  /** When this identity was last used successfully, or `null` if never. */
  readonly lastUsedAt: Date | null;
  // constructor throws IdentityAccountIdRequiredError for a blank
  // providerAccountId; toJSON/fromJSON as in User.
}
```

Invariant to test: for `PASSWORD`, `providerAccountId` is stored in normal form, so `Ada@Example.com` and `ada@example.com` cannot become two password identities for one address.

- [ ] **Step 2: Write the two policies — this is the task's real content**

`assertAtLeastOneIdentityRemains.ts`:

```ts
/**
 * The unlink invariant: a user must always keep at least one way in.
 *
 * Expressed here, as a pure function over the identities themselves, rather
 * than as a query in an implementation — because it is a rule about the
 * domain, and because an implementation that enforced it with its own count
 * query would be a second, divergeable copy of it. Both implementations of
 * {@link IIdentityService} call this.
 *
 * @throws LastIdentityRemovalError when removing `removingId` would leave none
 * @throws IdentityNotFoundError when `removingId` is not among `identities`
 */
export function assertAtLeastOneIdentityRemains(
  identities: readonly AuthIdentity[],
  removingId: AuthIdentityId,
): void {
  if (!identities.some((identity) => identity.id === removingId)) {
    throw new IdentityNotFoundError(removingId);
  }
  if (identities.length <= 1) {
    throw new LastIdentityRemovalError();
  }
}
```

`evaluatePassword.ts` returns **every** violation rather than the first, so a person is told all of what is wrong at once:

```ts
/** The knobs a deployment may turn. Defaults are deliberately modest — length carries most of the strength. */
export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireMixedCase: boolean;
  requireDigit: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  // An upper bound exists because a derivation function's cost grows with input
  // and an unbounded secret is a way to make the server do unbounded work.
  maxLength: 200,
  requireMixedCase: false,
  requireDigit: false,
};

export function evaluatePassword(secret: string, policy: PasswordPolicy): PasswordPolicyViolation[];
```

`PasswordPolicyViolation` is a string-union enum: `TOO_SHORT`, `TOO_LONG`, `NEEDS_MIXED_CASE`, `NEEDS_DIGIT`.

Write the TSDoc for `DEFAULT_PASSWORD_POLICY` carefully: it must say why the composition rules default to `false` (they push people toward predictable substitutions and buy little next to length) so that a generated project's author is making a choice rather than inheriting an accident.

**`IBreachedPasswordRegistry`** is the hook point spec §9.3 asks for:

```ts
/**
 * A source of knowledge about secrets that are already public.
 *
 * A port, not a vendor (ADR-0008): the template ships an implementation that
 * knows nothing, so a generated project has the seam without binding anyone's
 * account. Checking a secret against a public corpus is the single highest-value
 * strength check there is, and far more useful than any composition rule.
 */
export interface IBreachedPasswordRegistry {
  isKnownBreached(secret: string): Promise<boolean>;
}
```

- [ ] **Step 3: Tests for both policies, watched failing first**

`assertAtLeastOneIdentityRemains.spec.ts`:

```
throws IdentityNotFoundError when the id is not in the list
throws LastIdentityRemovalError when the list holds exactly that one identity
returns normally when two identities exist and one is being removed
throws LastIdentityRemovalError for an empty list (via not-found first — assert which error wins and why)
```

`evaluatePassword.spec.ts` must cover every branch of every policy flag in both directions — that is what 100% branch coverage demands here, and it is also the honest test of a function whose whole job is branching.

- [ ] **Step 4: Contract, conformance suite and self-test**

`IIdentityService` is small on purpose:

```ts
export interface IIdentityService {
  /** The actor's own identities. There is no path to another user's. */
  listIdentities(actorId: UserId): Promise<AuthIdentity[]>;
  /**
   * Removes one of the actor's identities.
   * @throws LastIdentityRemovalError if it is the only one they have
   * @throws IdentityNotFoundError if it is not theirs — indistinguishable from
   * not existing, so the call cannot be used to probe for other people's ids
   */
  unlinkIdentity(actorId: UserId, identityId: AuthIdentityId): Promise<void>;
}
```

Shared suite assertions:

```
listIdentities
  returns the actor's identities and nothing else
  returns a password identity whose providerAccountId is in normal form
  never returns anything resembling secret material — assert the serialized
    identity's key set equals exactly the documented key set, so a field added
    later is a test failure rather than a leak
unlinkIdentity
  rejects LastIdentityRemovalError when it is the only identity
  rejects IdentityNotFoundError for an identity belonging to another user
  rejects IdentityNotFoundError for an id that does not exist
    (and the two rejections are the same error — assert that explicitly)
wire shape
  AuthIdentity.fromJSON(identity.toJSON()) equals the original
```

The key-set assertion is the one to write with care: it is the structural half of "identities carry no secret material", and it is the test that fails the day someone adds `passwordHash` to the entity for convenience.

- [ ] **Step 5: Prove it discriminates**

Inject, one at a time, observing and recording each failure:
1. Add a `secretHash` field to `AuthIdentity.toJSON()` in the reference implementation → the key-set assertion must fail.
2. Make `unlinkIdentity` permit removing the last identity → `LastIdentityRemovalError` assertion must fail.
3. Make `unlinkIdentity` throw a *different* error for another user's identity than for a missing one → the "same error" assertion must fail.

Then remove each fault and confirm green. Report the verbatim output of all three failures.

- [ ] **Step 6: Purity, lint, sanitize, commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/libs/core/src/identities template/libs/core/tests/identities template/libs/core/package.json template/libs/core/tsconfig.json template/libs/core/jest.config.js
git commit -m "feat(core): split auth identities from users, with the unlink invariant as core logic"
```

---

## Task 6: The `auth/` domain

Roadmap ordering decision 2, made real: login returns a **discriminated outcome**, never a token and never a boolean. Phase 5 adds an `MFA_REQUIRED` branch and every consumer's `switch` fails to compile until it handles it.

### A contradiction in the spec, resolved here

Spec §9.1 says core "does **not** name JWTs, cookies, **headers** or HTTP". Spec §9.6 then specifies `AuditEntry { … ip, userAgent, … }` — and `userAgent` is a header name. The two cannot both hold.

**Resolution: §9.1 wins.** Core calls these `clientAddress` and `clientLabel`, in both `Session` and `AuditEntry`. The backend maps its own request metadata onto them, which is exactly the boundary §9.1 draws. This is a deliberate departure from the spec's literal field names — it is recorded here, it is reported in the Phase 2 decision log, and if Mattia prefers the spec's spelling the change is a rename in two entities and two migrations.

**Files:**
- Create: `template/libs/core/src/auth/entities/{Session.ts,index.ts}`
- Create: `template/libs/core/src/auth/enums/{AuthenticationStatus.ts,AuthenticationRejectionReason.ts,index.ts}`
- Create: `template/libs/core/src/auth/errors/{InvalidCredentialsError.ts,SessionNotFoundError.ts,SessionLifetimeError.ts,ExpiredTokenError.ts,ConsumedTokenError.ts,index.ts}`
- Create: `template/libs/core/src/auth/types/{SessionId.ts,SessionJSON.ts,AuthenticationOutcome.ts,AuthenticationAttempt.ts,RegisterInput.ts,ClientContext.ts,index.ts}`
- Create: `template/libs/core/src/auth/contracts/{IAuthService.ts,index.ts}`
- Create: `template/libs/core/src/auth/testing/{IAuthServiceContractDeps.ts,runIAuthServiceContract.ts,runIAuthServiceSecurityContract.ts,auth-fixtures.ts,index.ts}`
- Modify: `template/libs/core/package.json`, `tsconfig.json`, `jest.config.js`
- Test: `template/libs/core/tests/auth/entities/Session.spec.ts`
- Test: `template/libs/core/tests/auth/testing/{runIAuthServiceContract.spec.ts,runIAuthServiceSecurityContract.spec.ts}`

**Interfaces:**
- Consumes: `User`, `UserId`, `normalizeEmail`, `assertNever`, `DomainError`.
- Produces:
  - `class Session` — `id, userId, createdAt, lastUsedAt, expiresAt, revokedAt, clientAddress, clientLabel`; `isActive(now: Date): boolean`
  - `type AuthenticationOutcome` (discriminated on `status`)
  - `enum AuthenticationStatus { AUTHENTICATED, REJECTED }`
  - `enum AuthenticationRejectionReason { UNKNOWN_ACCOUNT, INVALID_SECRET, EMAIL_NOT_VERIFIED, ACCOUNT_SUSPENDED, ACCOUNT_DELETED }`
  - `interface IAuthService`
  - `runIAuthServiceContract(deps)` and `runIAuthServiceSecurityContract(deps)`

- [ ] **Step 1: Write `Session`**

```ts
/**
 * One continuous period during which a person is treated as signed in.
 *
 * A session is a domain fact: it began, it was last used, it ends at a
 * particular instant, and it can be ended early. How a caller *demonstrates*
 * that it holds a session — what the credential looks like, where it is kept,
 * how it is renewed — is not modelled here and never will be; that belongs to
 * whoever is doing the transporting.
 */
export class Session {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly expiresAt: Date;
  /** When it was ended early, or `null` if it ran or is running its course. */
  readonly revokedAt: Date | null;
  /** The network address the session began from, as the implementation saw it. */
  readonly clientAddress: string | null;
  /** A short, opaque description of the client, for the owner to recognize. */
  readonly clientLabel: string | null;

  /** Whether the session may still be used at `now`. */
  isActive(now: Date): boolean {
    return this.revokedAt === null && this.expiresAt.getTime() > now.getTime();
  }
}
```

Invariants to enforce in the constructor and test: `expiresAt` must be after `createdAt` (`SessionLifetimeError`); `lastUsedAt` must not precede `createdAt`. Test `isActive` at the boundary — exactly `expiresAt` is **not** active, one millisecond before is.

- [ ] **Step 2: Write the outcome — the piece Phase 5 depends on**

`AuthenticationRejectionReason` carries a warning that must survive into the shipped file:

```ts
/**
 * Why an authentication attempt failed.
 *
 * **This is server-side knowledge and is never returned to whoever made the
 * attempt.** It exists so the audit log can record precisely what happened. A
 * caller is told only that the attempt failed: a response that distinguished
 * "no such account" from "wrong secret" would let anyone test an address for
 * existence, one request at a time. The identical-response rule is asserted by
 * D7 and is the reason this enum is not part of any wire shape.
 */
export enum AuthenticationRejectionReason { … }
```

`AuthenticationOutcome`:

```ts
/**
 * The result of an authentication attempt.
 *
 * A discriminated union rather than a boolean or a credential, because the set
 * of ways an attempt can end is going to grow — a deployment that requires a
 * second factor introduces an outcome that is neither success nor failure but
 * "not yet". Adding a member here makes every `switch` that does not handle it
 * a compile error, which is precisely the property that makes that change
 * cheap. Every consumer ends its `switch` with `assertNever`.
 */
export type AuthenticationOutcome =
  | {
      readonly status: AuthenticationStatus.AUTHENTICATED;
      readonly user: User;
      readonly session: Session;
    }
  | {
      readonly status: AuthenticationStatus.REJECTED;
      readonly reason: AuthenticationRejectionReason;
    };
```

Note what is absent: no credential of any kind. The backend's response carries an access token beside this shape; the webapp's implementation takes that token out, hands it to its store, and returns exactly this. Core never learns it existed.

- [ ] **Step 3: Write `IAuthService`**

```ts
export interface IAuthService {
  /**
   * Begins registration. Always resolves, whether or not the address is already
   * in use — a distinguishable failure here is the same enumeration oracle that
   * login and password recovery are careful to avoid, and registration is the
   * easiest of the three to probe. What the person receives at the address
   * tells them which of the two happened; a stranger learns nothing.
   */
  register(input: RegisterInput): Promise<void>;

  /** Consumes a verification token. Single-use and expiring. */
  verifyEmail(token: string): Promise<void>;

  /** Re-issues verification. Always resolves, for the same reason as `register`. */
  resendVerification(email: string): Promise<void>;

  /** Attempts authentication. Never throws for a failed attempt — failure is an outcome. */
  authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome>;

  /** Always resolves, whether or not the address is known. */
  requestPasswordReset(email: string): Promise<void>;

  /** Consumes a reset token and replaces the secret. Ends every session the user holds. */
  resetPassword(token: string, newSecret: string): Promise<void>;

  /** Replaces the actor's own secret, proving the current one first. */
  changePassword(actorId: UserId, currentSecret: string, newSecret: string): Promise<void>;

  /** The actor's own sessions, newest first. */
  listSessions(actorId: UserId): Promise<Session[]>;

  /** Ends one of the actor's own sessions. */
  revokeSession(actorId: UserId, sessionId: SessionId): Promise<void>;

  /** Ends every session the actor holds, including the current one. */
  revokeAllSessions(actorId: UserId): Promise<void>;
}
```

**Renewing a session is not on this contract.** Rotation and reuse detection need the presented credential, which under DEC-3 lives somewhere the webapp cannot read; a method both implementations must have would force the webapp to pretend. Renewal is a backend capability (Task 11) reached by the webapp through a fetcher, not through this contract. Do not "complete" the interface by adding it.

`AuthenticationAttempt` is `{ email: string; secret: string; client: ClientContext }`, and `ClientContext` is `{ address: string | null; label: string | null }`.

- [ ] **Step 4: Write the two suites**

`runIAuthServiceContract` — shared, driven by both apps:

```
register
  resolves for a new address
  resolves for an address that already has an account (indistinguishable)
  rejects WeakPasswordError for a secret below the policy minimum
verifyEmail
  a valid token verifies the account: a later authenticate() succeeds
  rejects ConsumedTokenError when the same token is presented twice
  rejects ExpiredTokenError for an expired token
authenticate
  returns AUTHENTICATED with a user and an active session for good credentials
  returns REJECTED for a wrong secret — and does not throw
  the returned session belongs to the authenticated user and isActive(now)
changePassword
  succeeds with the correct current secret
  rejects InvalidCredentialsError with a wrong one
listSessions / revokeSession / revokeAllSessions
  a fresh login appears in listSessions
  revokeSession removes it from the active set
  revokeSession rejects SessionNotFoundError for another user's session
  revokeAllSessions leaves listSessions empty
wire shape
  Session.fromJSON(session.toJSON()) equals the original
exhaustiveness
  a switch over the outcome handles both members and ends in assertNever
```

`runIAuthServiceSecurityContract` — backend only (DEC-1):

```
an unverified account with the correct secret returns REJECTED(EMAIL_NOT_VERIFIED),
  never AUTHENTICATED, and issues no session
a SUSPENDED account with the correct secret returns REJECTED(ACCOUNT_SUSPENDED)
a soft-deleted account with the correct secret returns REJECTED(ACCOUNT_DELETED)
a wrong secret for a known address returns REJECTED(INVALID_SECRET)
an unknown address returns REJECTED(UNKNOWN_ACCOUNT)
  — and, critically: the two previous cases produce outcomes that are equal once
    `reason` is removed, which is the property the transport layer relies on
resetPassword consumes its token: presenting it again rejects ConsumedTokenError
resetPassword ends every session the user held
changePassword ends every *other* session the user held
a revoked session is not active even before it expires
```

- [ ] **Step 5: Self-test both suites against an in-memory reference implementation**

One reference implementation in `libs/core/tests/auth/testing/` drives both suites. Writing it is also the cheapest possible proof that the contract is implementable at all — Phase 1's Task 6 found a brief whose own code failed its own test, and an implementer running the code found it before anyone reading it did.

- [ ] **Step 6: Prove the suites discriminate**

Inject and observe each, recording verbatim output:
1. Make `authenticate` return `AUTHENTICATED` for an unverified account → the security suite must fail.
2. Make `authenticate` throw for an unknown address instead of returning `REJECTED` → the shared suite must fail (it asserts "does not throw").
3. Make `resetPassword` leave other sessions alive → the security suite must fail.
4. Make the `UNKNOWN_ACCOUNT` and `INVALID_SECRET` outcomes differ in a field other than `reason` → the indistinguishability assertion must fail.
5. Remove the `assertNever` default from the exhaustiveness test's switch and add a third member to the union locally → confirm the **compiler** rejects it. This one is a typecheck failure, not a test failure; run `npx nx typecheck core` and paste the error.

- [ ] **Step 7: Purity, lint, sanitize, commit**

This is the task most likely to trip the purity guard: everything about sessions invites transport words. Run `npm run purity -w libs/core` before you believe you are done, and expect it to catch you at least once.

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/libs/core/src/auth template/libs/core/tests/auth template/libs/core/package.json template/libs/core/tsconfig.json template/libs/core/jest.config.js
git commit -m "feat(core): model authentication as a discriminated outcome over sessions"
```

---

## Task 7: The `audit/` domain

The audit log lands now, in Phase 2, rather than last. Every later phase then records its own events as it builds them; bolting a cross-cutting log on at the end means revisiting every handler that should have written one.

**Files:**
- Create: `template/libs/core/src/audit/entities/{AuditEntry.ts,index.ts}`
- Create: `template/libs/core/src/audit/enums/{AuditAction.ts,index.ts}`
- Create: `template/libs/core/src/audit/types/{AuditEntryId.ts,AuditEntryJSON.ts,RecordAuditEntryInput.ts,AuditQuery.ts,index.ts}`
- Create: `template/libs/core/src/audit/contracts/{IAuditService.ts,index.ts}`
- Create: `template/libs/core/src/audit/testing/{IAuditServiceContractDeps.ts,runIAuditServiceContract.ts,audit-fixtures.ts,index.ts}`
- Modify: `template/libs/core/package.json` (five new subpaths)
- Test: `template/libs/core/tests/audit/entities/AuditEntry.spec.ts`
- Test: `template/libs/core/tests/audit/testing/runIAuditServiceContract.spec.ts`

**Interfaces:**
- Consumes: `UserId`, `PaginatedResult`, `DomainError`, `Brand`.
- Produces: `class AuditEntry`, `enum AuditAction`, `interface IAuditService` — `record(input: RecordAuditEntryInput): Promise<void>` and `query(actorId: UserId, query: AuditQuery): Promise<PaginatedResult<AuditEntry>>`, and nothing else.

- [ ] **Step 1: Write the entry and the action enum**

`organizationId` is nullable and stays `null` for every entry this phase writes — no organization exists until Phase 3. It is on the entity now because adding a column to an append-only table later means backfilling rows nobody is allowed to update. Type it `string | null` with TSDoc saying it becomes a branded `OrganizationId` in Phase 3; that is a one-line widening at a handful of call sites, where adding the column later is a migration against a table the application cannot write to.

Field names follow Task 6's resolution of the spec's internal contradiction: `clientAddress` and `clientLabel`, not `ip` and `userAgent`.

`AuditAction` ships the Phase 2 vocabulary:

```ts
/**
 * What happened. One member per kind of event worth reconstructing later.
 *
 * Members are added by later phases and never renamed or removed: a stored
 * value that changes meaning makes every historical entry a lie, and this is a
 * table nothing is permitted to rewrite.
 */
export enum AuditAction {
  USER_REGISTERED = 'USER_REGISTERED',
  EMAIL_VERIFICATION_REQUESTED = 'EMAIL_VERIFICATION_REQUESTED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  LOGIN_SUCCEEDED = 'LOGIN_SUCCEEDED',
  /** Recorded with the reason, which the person attempting it is never told. */
  LOGIN_FAILED = 'LOGIN_FAILED',
  SESSION_RENEWED = 'SESSION_RENEWED',
  /** Recorded when a credential that has already been used is presented again. */
  SESSION_REUSE_DETECTED = 'SESSION_REUSE_DETECTED',
  LOGGED_OUT = 'LOGGED_OUT',
  SESSION_REVOKED = 'SESSION_REVOKED',
  ALL_SESSIONS_REVOKED = 'ALL_SESSIONS_REVOKED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  IDENTITY_UNLINKED = 'IDENTITY_UNLINKED',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  USER_STATUS_CHANGED = 'USER_STATUS_CHANGED',
  PLATFORM_ROLE_CHANGED = 'PLATFORM_ROLE_CHANGED',
  /** Every time platform administration is used to pass a check that would otherwise deny. */
  PLATFORM_ADMIN_OVERRIDE = 'PLATFORM_ADMIN_OVERRIDE',
}
```

`metadata` is `Readonly<Record<string, unknown>>`. Its TSDoc must state the one rule that matters: **nothing secret, ever** — no secret, no derivation of one, no single-use credential. The audit log is the most-read table in an incident and the least-protected in a backup.

- [ ] **Step 2: Write the contract, whose shape is the guarantee**

```ts
/**
 * The append-only record of what happened.
 *
 * There is no `update`, no `delete`, no `purge`. The absence is the point: an
 * interface that cannot express a change is one no caller can be talked into
 * making. This is only half of the guarantee, and the weaker half — the other
 * half is a database grant that refuses the statement even if some future code
 * bypasses this interface entirely (D13). A convention that lives only in an
 * interface is a convention; a privilege is a guarantee.
 */
export interface IAuditService {
  /**
   * Records an entry. Never rejects for a business reason: an audit write that
   * could fail a caller's operation would create pressure to make it optional,
   * and an optional audit log is not one.
   */
  record(input: RecordAuditEntryInput): Promise<void>;

  /**
   * Reads entries the actor is entitled to see. In this phase that means a
   * platform administrator reading across the deployment; Phase 3 adds
   * organization administrators reading their own organization's entries, which
   * is why {@link AuditQuery} already carries an `organizationId` filter.
   */
  query(actorId: UserId, query: AuditQuery): Promise<PaginatedResult<AuditEntry>>;
}
```

- [ ] **Step 3: Conformance suite, self-test, and the discrimination proof**

Shared suite assertions:

```
record
  an entry becomes visible to query()
  records the actor, action, resource and instant faithfully
  accepts a null actor — an unauthenticated failed login has no actor
  accepts null metadata fields without collapsing them
query
  returns newest first
  filters by action
  filters by actor
  paginates: meta.total counts all matches, not the page
wire shape
  AuditEntry.fromJSON(entry.toJSON()) equals the original
shape guarantee
  the interface exposes exactly two methods — assert
    Object.getOwnPropertyNames on the reference implementation's prototype
    contains no member whose name matches /update|delete|remove|purge|truncate/
```

The last assertion is a genuine, if modest, guard: it fails the day someone adds a convenience method to an implementation. Say plainly in a comment that it is a smoke alarm, not a lock — the lock is the grant in Task 8 — so nobody mistakes it for the guarantee.

Inject and observe: add a `deleteEntry` method to the reference implementation and watch the shape assertion fail; make `query` return oldest-first and watch the ordering assertion fail. Record both.

- [ ] **Step 4: Purity, lint, sanitize, commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/libs/core/src/audit template/libs/core/tests/audit template/libs/core/package.json
git commit -m "feat(core): add the append-only audit contract"
```

---

## Task 8: Persistence, the two database roles, and the migrations

DEC-2, and the most structurally invasive task in the phase. It changes Phase 1 files, and it is where D13 stops being a promise.

**The shape:** migrations run as the schema owner — the role the Postgres image creates. The application connects as a second, restricted role. `ALTER DEFAULT PRIVILEGES` gives that role full DML on tables the owner creates *afterwards*, so Phase 3 does not need a "remember to grant" step. `audit_entries` then has `UPDATE` and `DELETE` revoked from it specifically.

> **Everything in this task's SQL is a hypothesis until you have run it.** Postgres rejects bind parameters in utility statements such as `CREATE ROLE`, `ALTER DEFAULT PRIVILEGES` is order-sensitive with respect to table creation, and role-creation idempotency is easy to get subtly wrong. Bring up a throwaway Postgres 16 container on a free port, run each statement, and correct this plan where it is wrong. Phase 1's log records four separate controller prescriptions that were wrong and were caught exactly this way.

**Files:**
- Create: `template/apps/backend/src/db/migrations/1758000000000-AppRoleAndDefaultPrivileges.ts`
- Create: `template/apps/backend/src/db/migrations/1758000001000-IdentityFoundation.ts`
- Create: `template/apps/backend/src/db/migrations/1758000002000-AuditAppendOnly.ts`
- Create: `template/apps/backend/src/users/user.entity.ts`
- Create: `template/apps/backend/src/identities/auth-identity.entity.ts`
- Create: `template/apps/backend/src/auth/entities/{session.entity.ts,refresh-token.entity.ts,email-verification-token.entity.ts,password-reset-token.entity.ts}`
- Create: `template/apps/backend/src/audit/audit-entry.entity.ts`
- Modify: `template/apps/backend/src/db/data-source.ts` (connect as the owner; register entities)
- Modify: `template/apps/backend/src/app.module.ts` (connect as the app role; register entities)
- Modify: `template/compose.yaml`, `template/compose.prod.yaml`, `template/.env.example`
- Test: `template/apps/backend/src/db/__tests__/migration-sql.spec.ts` (the SQL is asserted as text; behaviour is proven in Task 19)

**Interfaces:**
- Consumes: the core entities from Tasks 4–7 (the TypeORM entities carry the same field names plus the columns core deliberately does not model — secret derivations, token hashes).
- Produces: the schema; `MIGRATION_DATABASE_URL` and `DATABASE_URL` as two distinct connection strings; the `APP_DB_ROLE` / `APP_DB_PASSWORD` environment contract.

- [ ] **Step 1: Stand up a throwaway Postgres and verify the role SQL before writing a migration**

```bash
PORT=$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")
docker run -d --name forge-sqlprobe-$$ -e POSTGRES_USER=owner -e POSTGRES_PASSWORD=ownerpw \
  -e POSTGRES_DB=probe -p "$PORT:5432" postgres:16-alpine
```

Name the container with `$$` so it cannot collide with anything already running, and remove **only** that container when you are done. Never `docker rm` anything you did not start; this machine runs unrelated Postgres containers.

Verify, in order, and record the verbatim result of each:

1. `CREATE ROLE` rejects a bind parameter: `CREATE ROLE app LOGIN PASSWORD $1` — confirm the error, so the workaround below is justified rather than assumed.
2. The `format()` round-trip works and escapes correctly:
   ```sql
   SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text);
   ```
   then execute the returned text. Try a role name and a password containing a quote, and confirm the escaping holds.
3. Idempotency: `SELECT 1 FROM pg_roles WHERE rolname = $1` guards it.
4. `ALTER DEFAULT PRIVILEGES FOR ROLE current_user IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;` — then create a table **as the owner** and confirm the app role can write to it **without any explicit grant**.
5. Confirm the same for sequences (`GRANT USAGE, SELECT ON SEQUENCES`), or establish that the schema's identity columns do not need it — find out rather than including a statement that does nothing.
6. `REVOKE UPDATE, DELETE ON audit_entries FROM app;` — then, connected **as the app role**, confirm `INSERT` and `SELECT` succeed and `UPDATE` and `DELETE` are rejected with `permission denied`. Paste the error.
7. Confirm the app role cannot regain the privilege itself: as the app role, `GRANT UPDATE ON audit_entries TO app;` must fail. If it does not, the guarantee is decorative and this task's design is wrong — report that immediately.

- [ ] **Step 2: Write the role migration**

`1758000000000-AppRoleAndDefaultPrivileges.ts` must:

- Read `APP_DB_ROLE` and `APP_DB_PASSWORD` from the environment and **fail loudly** if either is missing. A default password here would ship a known credential in every generated project.
- Validate the role name against `/^[a-z_][a-z0-9_]{0,62}$/` and throw otherwise, before it reaches any SQL. `format('%I')` escapes correctly, but a role name arriving from configuration deserves a check that is readable in review.
- Create the role only if absent, grant `CONNECT` on the database and `USAGE` on schema `public`.
- Set the default privileges **before** any table exists. Ordering is the whole mechanism.
- `down()` revokes and drops the role. Guard the drop: a role that owns objects cannot be dropped, so `down()` must fail clearly rather than half-succeed.

Write the TSDoc so the next person understands *why* two roles exist, not just that they do. Point at ADR-0008 and at D13.

- [ ] **Step 3: Write the schema migration**

`1758000001000-IdentityFoundation.ts` creates seven tables. Columns follow the core entities plus the material core deliberately does not model:

| Table | Beyond the core entity |
|---|---|
| `users` | — |
| `auth_identities` | `secret_hash` (nullable; `PASSWORD` only), `secret_algorithm`, `secret_params` |
| `sessions` | — |
| `refresh_tokens` | `token_hash`, `session_id`, `replaced_by_id`, `used_at`, `expires_at` |
| `email_verification_tokens` | `token_hash`, `user_id`, `expires_at`, `consumed_at` |
| `password_reset_tokens` | `token_hash`, `user_id`, `expires_at`, `consumed_at` |
| `audit_entries` | — |

Constraints that are load-bearing, not decoration:

- `users.email` — unique. Store the normal form; the application normalizes, and a partial or functional index will not save you if it does not.
- `auth_identities (provider, provider_account_id)` — unique. This is what makes "one account per address per provider" true in the database rather than in a race-prone check-then-insert.
- `refresh_tokens.token_hash` — unique, and indexed: it is looked up on every renewal.
- Every `*_token_hash` column stores a hash, never the credential. Say so in a column comment — a `COMMENT ON COLUMN` survives into `\d+` where a code comment does not.
- Foreign keys to `users` are `ON DELETE CASCADE` for sessions and tokens, and **not** for `audit_entries`: an audit entry must outlive the account it refers to, which is the whole reason `actor_user_id` is nullable.

- [ ] **Step 4: Write the append-only migration**

`1758000002000-AuditAppendOnly.ts` revokes `UPDATE` and `DELETE` on `audit_entries` from the app role, and its `down()` restores them. Keep it a separate migration from the table creation: the intent is legible in the migration list, and a reviewer can see the guarantee being applied rather than hunting for it inside a 300-line schema migration.

- [ ] **Step 5: Split the two connections**

`src/db/data-source.ts` — used only by the TypeORM CLI, so it connects as the **owner**:

```ts
url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
```

The fallback is deliberate and must be commented: a deployment that has not adopted two roles still works, it simply does not get D13's guarantee. A generated project that cannot run its migrations at all would be worse.

`src/app.module.ts` — the runtime connects as the app role via `DATABASE_URL`, unchanged in name. Register all seven entities. Leave `synchronize: false` alone (B4).

- [ ] **Step 6: Update compose, prod compose and `.env.example`**

Dev `compose.yaml` — obviously-local credentials inline, exactly as Phase 1 established:

```yaml
    environment:
      DATABASE_URL: postgresql://__FORGE_NAME___app:__FORGE_NAME___app@postgres:5432/__FORGE_DB_NAME__
      MIGRATION_DATABASE_URL: postgresql://__FORGE_NAME__:__FORGE_NAME__@postgres:5432/__FORGE_DB_NAME__
      APP_DB_ROLE: __FORGE_NAME___app
      APP_DB_PASSWORD: __FORGE_NAME___app
```

`compose.prod.yaml` — every value from the environment with no default, `${APP_DB_PASSWORD:?required}`, on both the `migrate` one-shot and the `backend` service. The `migrate` service gets `MIGRATION_DATABASE_URL`; `backend` must **not** receive it, so a mistake cannot silently run the application as the owner.

`.env.example` — document both URLs and the role variables, values empty or dev-local as Phase 1 established.

**Run `npm run sanitize` at this point, before going further.** Phase 1's populated-secret rule matches `KEY: value` as well as `KEY=value`, case-insensitively, after stripping `${...}` interpolations. `APP_DB_PASSWORD: __FORGE_NAME___app` may well trip it where `POSTGRES_PASSWORD: __FORGE_NAME__` does not — verify rather than assume, and if it trips, report it before reaching for `# sanitize:allow`. The exemption count is currently one, and Phase 1 left a standing instruction to tighten the marker to per-rule granularity if it ever exceeds one.

- [ ] **Step 7: Write the SQL text test**

`migration-sql.spec.ts` asserts the migration *text*, which is all a unit test can honestly do without a database:

```
the audit migration revokes UPDATE and DELETE and grants nothing back
the schema migration creates audit_entries with a nullable actor_user_id
no migration contains 'synchronize'
the role migration throws when APP_DB_ROLE is absent
the role migration rejects a role name containing a quote or a space
```

The behavioural proof — that the database actually refuses the statement — is D13 in Task 19. Say so in the file header, so nobody reads this spec as the guarantee.

- [ ] **Step 8: Clean up, verify Voku, sanitize, commit**

```bash
docker rm -f forge-sqlprobe-$$
docker ps --format '{{.Names}}'     # confirm only containers you did not start remain
```

Confirm the unrelated containers on this machine are still running and untouched, and report their names and uptimes. Then:

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/apps/backend/src template/compose.yaml template/compose.prod.yaml template/.env.example
git commit -m "feat(backend): add the identity schema and the two-role append-only audit guarantee"
```

---

## Task 9: The password hashing adapter

**Start with the probe, not the code.** `argon2` is a native module, and the template ships a `package-lock.json` generated on this macOS/arm64 host while both Dockerfiles run `npm ci` inside `node:22-bookworm-slim`. That is the same shape as the Storybook failure nobody has root-caused. Find out in ten minutes rather than in Task 19.

**Why the port lives in the backend, not in core:** core models no stored secret at all — `AuthIdentity` has no field for one (Task 5, ADR-0005). A hashing port in core would have nothing to hash and would drag parameter tuning into a package that must stay free of runtime concerns. ADR-0008 asks for ports with dev adapters, not for every port to live in core.

**Files:**
- Create: `template/apps/backend/src/identities/hashing/{IPasswordHasher.ts,Argon2PasswordHasher.ts,index.ts}`
- Create: `template/apps/backend/src/common/crypto/{generateOpaqueToken.ts,hashOpaqueToken.ts,index.ts}`
- Modify: `template/apps/backend/package.json` (add the hashing dependency)
- Modify: `template/package-lock.json` (via `npm run refresh-lockfile`)
- Test: `template/apps/backend/src/identities/hashing/__tests__/Argon2PasswordHasher.spec.ts`
- Test: `template/apps/backend/src/common/crypto/__tests__/opaque-token.spec.ts`

**Interfaces:**
- Consumes: `evaluatePassword`, `DEFAULT_PASSWORD_POLICY`, `WeakPasswordError` from `__FORGE_SCOPE__/core/identities/{policies,types,errors}`.
- Produces:
  - `interface IPasswordHasher` — `hash(secret: string): Promise<StoredSecret>`, `verify(secret: string, stored: StoredSecret): Promise<boolean>`, `needsRehash(stored: StoredSecret): boolean`
  - `type StoredSecret = { hash: string; algorithm: string; params: Record<string, number> }`
  - `generateOpaqueToken(): { token: string; hash: string }` and `hashOpaqueToken(token: string): string`
  Tasks 11 and 12 consume all of these.

- [ ] **Step 1: Probe the native dependency inside the real base image**

```bash
cd "$(mktemp -d)"
cat > Dockerfile <<'EOF'
FROM node:22-bookworm-slim
WORKDIR /probe
RUN npm init -y >/dev/null
RUN npm install argon2@^0.44.0
RUN node -e "const a=require('argon2');a.hash('x',{type:a.argon2id}).then(h=>{console.log('HASHED',h.slice(0,32));return a.verify(h,'x')}).then(ok=>console.log('VERIFY',ok))"
EOF
docker build --progress=plain -t forge-argon2-probe-$$ .
```

Then the harder half, which is the one that actually bites: repeat it with the **template's own lockfile** rather than a fresh install, because `npm ci` is what the Dockerfiles run:

```bash
# in a generated project, after adding the dependency and refreshing the lockfile
docker build -f apps/backend/Dockerfile --target prod -t forge-argon2-ci-$$ .
```

Record whether a prebuilt binary is fetched, whether a compile is triggered (look for `node-gyp` in the output), and how long the layer takes. Remove both images afterwards. **Do not remove any image you did not build.**

If `npm ci` fails or falls back to a source build that needs a toolchain not present in the slim image, report it and choose between:
1. `@node-rs/argon2` — prebuilt per-platform binaries as optional dependencies. Check that the macOS-generated lockfile records the `linux-x64-gnu`/`linux-arm64-gnu` entries; the well-known failure mode of this approach is a lockfile that knows only the host's platform.
2. Adding the build toolchain to the builder stage only.
3. `bcrypt`, which the source project uses and which is therefore known to work here — a real downgrade from the spec's argon2id, and one to escalate rather than take unilaterally.

Report which you picked and why. **This is a decision with a cost; do not make it silently.**

- [ ] **Step 2: Write the hasher test, then the hasher**

```
hash() returns a distinct hash for the same secret twice (a salt is present)
verify() accepts the correct secret and rejects a wrong one
verify() returns false, never throws, for a malformed stored value
needsRehash() is false for a value produced with the current parameters
needsRehash() is true for a value produced with weaker parameters
hash() rejects a secret longer than the policy maximum rather than doing unbounded work
```

Parameters: argon2id, and state the chosen memory/time/parallelism in a comment with the reason. Whatever you pick, `needsRehash` must key off the *stored* parameters, not off a version number you remember to bump.

- [ ] **Step 3: Write the opaque-token helpers — and read this before you do**

Verification tokens, reset tokens and refresh credentials are **not** passwords and must not be hashed like them. They are generated by the server from a CSPRNG with full entropy, so there is nothing to brute-force and a deliberately slow derivation buys nothing while making every session renewal expensive. They get a plain SHA-256. Passwords are chosen by people, have little entropy, and need a slow derivation. Using one for the other is wrong in both directions, and it is a mistake that looks like diligence.

```ts
/**
 * A single-use credential and the value stored in its place.
 *
 * 32 bytes from the platform CSPRNG, base64url-encoded. Only the digest is
 * persisted, so a copy of the table is not a set of working credentials. The
 * digest is a plain SHA-256 rather than a password derivation: the input is
 * full-entropy and uniformly random, so there is no guessing to slow down, and
 * a slow digest here would tax every renewal for nothing.
 */
export function generateOpaqueToken(): { token: string; hash: string };
```

Comparison is by digest equality on a value looked up by digest, so no secret-dependent branch exists on the lookup path. If you find yourself comparing two secrets directly anywhere, use `crypto.timingSafeEqual` and say why in a comment.

Tests: the token is at least 32 bytes of entropy; two calls never collide; `hashOpaqueToken(token)` equals the hash returned alongside it; the raw token never appears in the returned hash.

- [ ] **Step 4: Refresh the lockfile, verify, commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run refresh-lockfile
npm run sanitize
git add template/apps/backend template/package-lock.json
git commit -m "feat(backend): add the password hashing adapter and opaque-token helpers"
```

---

## Task 10: The mail port and its dev adapter

ADR-0008's first instance. The template binds no account and carries no key; verification and reset messages are written to disk where a developer — and Task 19's e2e — can read them.

`IMailer` lives in the backend for the same reason `IPasswordHasher` does: core has no notion of a message, and giving it one would mean modelling delivery in a package that must not know how anything reaches anyone.

**Files:**
- Create: `template/apps/backend/src/mail/{IMailer.ts,FileMailer.ts,mail.module.ts,index.ts}`
- Create: `template/apps/backend/src/mail/templates/{verify-email.ts,reset-password.ts,index.ts}`
- Modify: `template/apps/backend/src/app.module.ts`, `template/.env.example`, `template/compose.yaml`, `template/.gitignore`
- Test: `template/apps/backend/src/mail/__tests__/FileMailer.spec.ts`

**Interfaces:**
- Consumes: nothing from core.
- Produces: `interface IMailer { send(message: OutboundMessage): Promise<void> }`, `MAILER` injection token, `FileMailer`. Tasks 11 and 12 inject `MAILER`; Task 19 reads the directory it writes to.

- [ ] **Step 1: Write the port and the adapter**

`FileMailer` writes one file per message to `MAIL_OUTBOX_DIR` (default `./.mail-outbox`), named `<timestamp>-<random>.json`, containing recipient, subject, body and the moment it was written. JSON rather than `.eml` — the e2e has to parse it, and a format a test can `JSON.parse` beats one it has to unpick.

The adapter must log, at info level, the path it wrote and the address it wrote it for. A developer whose verification link goes nowhere should find out from the console, not from the absence of an email.

`.gitignore`: add `.mail-outbox/`. A generated project that commits its own outbox would commit live verification links.

- [ ] **Step 2: Write the two message templates**

Plain text, `__FORGE_TITLE__` in the subject, one link each. The link's base comes from `PUBLIC_WEBAPP_URL` (`.env.example`, defaulting to the dev webapp origin) — **never** reconstructed from the incoming request, which is how a host-header injection turns a password-reset link into a credential-harvesting link pointed at somebody else's domain. Write that reason into the code as a comment; it is not obvious, and the shortcut is tempting.

- [ ] **Step 3: Test it**

```
send() writes exactly one file, whose parsed contents carry the recipient, subject and body
send() creates the outbox directory if it is absent
two sends in the same millisecond produce two files, not one
the verification template's link is built from PUBLIC_WEBAPP_URL, not from any request value
```

- [ ] **Step 4: Sanitize and commit**

The word `PASSWORD` appears in `reset-password.ts`. Run `npm run sanitize` and confirm it is clean before committing — the populated-secret rule matches `PASSWORD` followed by a separator and a value, so a subject line is fine and `PASSWORD: something` is not. If it trips, report it rather than reaching for an exemption.

```bash
git add template/apps/backend/src/mail template/apps/backend/src/app.module.ts template/.env.example template/compose.yaml template/.gitignore
git commit -m "feat(backend): add the mail port and a dev adapter that binds no provider"
```

---

## Task 11: Registration, login and the session lifecycle

The endpoints that make an account real, and the two discriminating tests that prove the shape holds: **D6** (a new endpoint is protected unless it says otherwise) and **D8** (a renewal credential presented twice revokes the whole family).

**Files:**
- Create: `template/apps/backend/src/auth/{auth.module.ts,auth.service.ts,auth.controller.ts}`
- Create: `template/apps/backend/src/auth/dto/{register.dto.ts,login.dto.ts,auth-response.dto.ts,session-response.dto.ts,index.ts}`
- Create: `template/apps/backend/src/auth/guards/{jwt-auth.guard.ts,index.ts}`
- Create: `template/apps/backend/src/auth/decorators/{public.decorator.ts,current-user.decorator.ts,index.ts}`
- Create: `template/apps/backend/src/auth/strategies/{jwt.strategy.ts,index.ts}`
- Create: `template/apps/backend/src/auth/session/{session.service.ts,refresh-token.service.ts,index.ts}`
- Create: `template/apps/backend/src/identities/identities.service.ts`
- Create: `template/apps/backend/src/audit/{audit.module.ts,audit.service.ts}`
- Modify: `template/apps/backend/src/app.module.ts` (register the global guard), `template/apps/backend/src/main.ts` (cookie parsing)
- Modify: `template/apps/backend/package.json` (`@nestjs/jwt`, `passport`, `passport-jwt`, `@nestjs/passport`, `cookie-parser`, `supertest` + types as dev)
- Test: `template/apps/backend/src/auth/__tests__/{auth.service.spec.ts,refresh-rotation.spec.ts,global-guard.spec.ts}`

**Interfaces:**
- Consumes: `IAuthService`, `AuthenticationOutcome`, `Session`, `User` from core; `IPasswordHasher`, `generateOpaqueToken`, `hashOpaqueToken` from Task 9; `MAILER` from Task 10; the entities from Task 8.
- Produces: `AuthService implements IAuthService` (Task 13 drives both core suites against it); `@Public()`; `@CurrentUser()`; `RefreshTokenService.rotate(presented: string, client: ClientContext)`; the cookie name and options, which Tasks 16 and 19 depend on.

- [ ] **Step 1: Register the global guard, and write D6 before anything else**

`app.module.ts` gains:

```ts
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
```

`JwtAuthGuard` reads the `IS_PUBLIC` metadata that `@Public()` sets and lets those routes through; everything else requires a valid access token.

`global-guard.spec.ts` is **D6**, and it must be written so that it cannot be satisfied by an existing endpoint's own decorators. Define a controller **inside the spec file** with a single route carrying no decorators at all, register it in a testing module alongside the real `APP_GUARD` provider, and assert:

```
an undecorated route returns 401 with no credential          <- D6
the same route returns 200 with a valid access token
a route marked @Public() returns 200 with no credential
```

The first assertion is the one that matters: it proves a developer who adds an endpoint and forgets to think about authentication gets a closed door, not an open one.

- [ ] **Step 2: Watch D6 fail**

Remove the `APP_GUARD` provider. Run the spec. **Observe the undecorated route return 200.** Restore it and observe 401. Paste both outputs. A guard nobody has watched fail is not a guard, and this is the one that protects every endpoint anyone adds for the rest of the project's life.

- [ ] **Step 3: Implement registration and verification**

`register()`:
1. `evaluatePassword` against `DEFAULT_PASSWORD_POLICY`; reject `WeakPasswordError` **before** touching the database, so policy failure is indistinguishable in timing from anything else.
2. Consult `IBreachedPasswordRegistry` (the no-op implementation ships).
3. Normalize the address. If an account exists, send the "you already have an account" message and **return normally**. If not, create the user (`ACTIVE`, unverified, `PLATFORM_USER`), create the `PASSWORD` identity, issue a verification token, send the verification message, and return normally.
4. Audit `USER_REGISTERED` or `EMAIL_VERIFICATION_REQUESTED` accordingly — the *server* knows which happened even though the caller does not.

The controller returns `202 Accepted` with a fixed body in both cases. There is no branch in the response. Write a comment saying so, because the first person to "improve the UX" here will remove it.

`verifyEmail()` hashes the presented token, looks it up, rejects `ConsumedTokenError` if `consumed_at` is set and `ExpiredTokenError` if it has expired, sets `email_verified_at`, marks the token consumed, and audits `EMAIL_VERIFIED`. Consume and verify in **one transaction** — two concurrent presentations of the same token must not both succeed.

- [ ] **Step 4: Implement authentication**

`authenticate()` returns an outcome and never throws for a failed attempt:

1. Normalize the address, find the `PASSWORD` identity.
2. **If no identity exists, still perform a hash verification against a fixed dummy value**, then return `REJECTED(UNKNOWN_ACCOUNT)`. Without this, an unknown address returns in a millisecond and a known one takes the cost of a derivation, and the timing difference is an enumeration oracle that no amount of identical response bodies will close. This line is load-bearing; it will look like dead code to whoever reads it next, so comment it.
3. Verify the secret. On failure, audit `LOGIN_FAILED` with `INVALID_SECRET` and return `REJECTED(INVALID_SECRET)`.
4. On success, check `user.canAuthenticate()`. If it is false, return the matching rejection — unverified, suspended or deleted — and audit it. **Check this after verification, not before**, or the response time tells a stranger whether an address is registered.
5. If `needsRehash(stored)`, rehash and store. Spec §9.3's rehash-on-login.
6. Create a session, mint an access token, issue a refresh credential, audit `LOGIN_SUCCEEDED`, return `AUTHENTICATED`.

The controller maps the outcome with a `switch` ending in `assertNever`, and **both branches produce the same status code and the same body shape on failure**: `401` with a fixed message. The rejection reason never leaves the service.

- [ ] **Step 5: Implement rotation and reuse detection — D8**

`RefreshTokenService.rotate(presented, client)`:

1. Hash the presented value and look the row up. Not found → reject.
2. **If `used_at` is already set, this credential has been presented before.** Revoke the entire session — every refresh token in it, and the session itself — audit `SESSION_REUSE_DETECTED`, and reject. Do not return a new credential. The legitimate holder loses their session too, and that is correct: one of the two presenters is an attacker and there is no way to tell which.
3. Otherwise mark `used_at`, issue a new credential linked by `replaced_by_id`, bump the session's `last_used_at`, audit `SESSION_RENEWED`, and return the new pair.

Steps 1–3 run in **one transaction at `SERIALIZABLE` or with `SELECT ... FOR UPDATE`** on the token row. Two simultaneous presentations of the same valid credential must not both succeed; without the lock, reuse detection has a race exactly where it matters. Verify which isolation you get rather than assuming — and if `SERIALIZABLE` produces retry errors under the e2e, say so rather than quietly downgrading it.

`refresh-rotation.spec.ts` is **D8**:

```
rotating a valid credential returns a new one and invalidates the old
presenting the OLD credential after a rotation:
  - is rejected                                                   <- D8
  - revokes the session                                           <- D8
  - revokes every other refresh token in that session             <- D8
  - writes a SESSION_REUSE_DETECTED audit entry
  - and the ROTATED-TO credential is dead as well — assert this
    explicitly; revoking the family is the point, and an
    implementation that only kills the presented one looks
    identical on every other assertion
two concurrent rotations of the same credential: exactly one succeeds
```

- [ ] **Step 6: Watch D8 fail**

Change the reuse branch so it rejects the presented credential but leaves the session alive. Run the spec. **Observe the family assertions fail** while the simple "is rejected" assertion still passes — that is the whole reason the family assertions exist, and the reason the weaker test would have shipped a hole. Restore and confirm green. Paste both.

- [ ] **Step 7: Set the cookie, and keep it out of core's reach**

The refresh credential is set as `httpOnly`, `sameSite: 'lax'`, `secure` when `NODE_ENV === 'production'`, `path: '/auth'`, `maxAge` matching the credential's lifetime. Path-scoping means it is not attached to every request the application makes — only to the endpoints that renew or end a session.

Put the cookie name and options in **one** exported constant, used by login, refresh and logout. Three call sites each spelling their own options is how a logout ends up clearing a cookie that was never set, which fails silently and leaves a live credential in the browser.

`logout` clears the cookie **and** revokes the session server-side. Clearing alone is theatre: the credential still works for anyone who copied it.

- [ ] **Step 8: Verify, sanitize, commit**

Run the backend suite, `npx nx lint backend`, `npx nx typecheck backend` and `npm run purity -w libs/core` (the last because it is easy to let a transport word drift into core while working in this task). Then:

```bash
cd /Users/sinisimattia/Progetti/forge
npm run refresh-lockfile
npm run sanitize
git add template/apps/backend template/package-lock.json
git commit -m "feat(backend): add registration, login, session rotation and the global guard"
```

---

## Task 12: Recovery, profile and platform administration

Password recovery, the `/users/me` surface, identity listing and unlinking, and the four platform-admin endpoints DEC-4 puts in this phase. Ships **D7**.

**Files:**
- Create: `template/apps/backend/src/users/{users.module.ts,users.service.ts,users.controller.ts}`
- Create: `template/apps/backend/src/users/dto/{update-profile.dto.ts,user-response.dto.ts,list-users.query.dto.ts,set-platform-role.dto.ts,set-status.dto.ts,index.ts}`
- Create: `template/apps/backend/src/identities/{identities.module.ts,identities.controller.ts}`
- Create: `template/apps/backend/src/identities/dto/{identity-response.dto.ts,index.ts}`
- Create: `template/apps/backend/src/audit/audit.controller.ts`
- Create: `template/apps/backend/src/auth/guards/{platform-admin.guard.ts,index.ts}` (extend the barrel)
- Modify: `template/apps/backend/src/auth/{auth.service.ts,auth.controller.ts}` (recovery)
- Test: `template/apps/backend/src/auth/__tests__/enumeration-safety.spec.ts`
- Test: `template/apps/backend/src/users/__tests__/users.service.spec.ts`
- Test: `template/apps/backend/src/audit/__tests__/audit.controller.spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–11.
- Produces: `UsersService implements IUserService`, `IdentitiesService implements IIdentityService`, `AuditService implements IAuditService` — the three Task 13 drives the conformance suites against. `PlatformAdminGuard` and the `UserResponseDto` wire shape, which Task 15's webapp services parse.

- [ ] **Step 1: Implement recovery, enumeration-safe throughout**

`requestPasswordReset(email)`:
- Normalize. If an account exists, issue a single-use token and send the message. If not, **do nothing** — and take the same amount of work doing it. Audit `PASSWORD_RESET_REQUESTED` only when there was an account.
- Always resolve. The controller always returns `202` with a fixed body.

`resetPassword(token, newSecret)`: evaluate the new secret against the policy first; consume the token in one transaction; replace the stored secret; **revoke every session the user holds**; audit `PASSWORD_RESET_COMPLETED`. Revoking is not optional — the most likely reason someone is resetting is that they believe someone else has their credential.

`changePassword(actorId, current, next)`: verify `current`, apply the policy to `next`, replace, and revoke **every other** session while keeping the caller's own. Audit `PASSWORD_CHANGED`.

- [ ] **Step 2: Write D7 — and write it as a comparison, not as two assertions**

`enumeration-safety.spec.ts` drives the real controller through supertest against fake services, and compares **whole responses**:

```
POST /auth/login with a known address and a wrong secret
POST /auth/login with an address that has no account
  -> identical status code
  -> identical response body, compared with deepStrictEqual        <- D7
  -> identical set of response header names
     (compare the NAMES; Date and any timing header will differ in value)

POST /auth/forgot-password for a known address
POST /auth/forgot-password for an unknown address
  -> identical status and body                                     <- D7

POST /auth/register for a fresh address
POST /auth/register for an address that already has an account
  -> identical status and body
```

Compare the responses, do not assert each one against a literal. Two assertions against the same expected literal drift apart the day someone changes one and updates "its" expectation; a comparison of one response against the other cannot.

Timing is deliberately **not** asserted here — a timing assertion in a unit suite is flaky and will be deleted within a month. What protects timing is the dummy-verification step in Task 11 Step 4, and the review dimension that says so. Record this as a known limit rather than pretending the test covers it.

- [ ] **Step 3: Watch D7 fail, three times**

1. Make login return `404` with `{"error":"No such account"}` for an unknown address → the status and body comparisons must fail.
2. Make login return the *same* status but a body with a different `message` for the unknown case → the body comparison must fail while the status comparison still passes. This is the realistic regression, and the one a weaker test misses.
3. Make `forgot-password` return `{"sent":true}` only when an account exists → that comparison must fail.

Record all three verbatim, then restore and confirm green.

- [ ] **Step 4: Implement the user surface**

`GET /users/me`, `PATCH /users/me`, `DELETE /users/me`. Deletion soft-deletes, revokes every session, clears the refresh cookie, and audits `ACCOUNT_DELETED`. The account's row and its audit entries remain.

`GET /users/me/identities` and `DELETE /users/me/identities/:id` call `IIdentityService`, which calls core's `assertAtLeastOneIdentityRemains`. The controller must not re-implement the check — one rule, one place, and Task 5 put it in core precisely so both apps get the same answer.

`UserResponseDto` is built from `User.toJSON()`. It must not acquire fields of its own: the whole point of the shared wire shape is that Task 15's webapp parses exactly what core's `fromJSON` expects. B9's grep exists to catch secret material here.

- [ ] **Step 5: Implement platform administration (DEC-4)**

`GET /users`, `GET /users/:id`, `PATCH /users/:id/platform-role`, `PATCH /users/:id/status`, plus `GET /audit`.

`PlatformAdminGuard` layers under the global `JwtAuthGuard`. Every pass writes a `PLATFORM_ADMIN_OVERRIDE` audit entry — spec §9.5 requires that every platform-admin pass is logged, and "the endpoint is admin-only" is exactly such a pass.

Two invariants worth testing, because both are ways an administrator can lock everyone out or lock themselves in:
```
an administrator cannot remove their OWN platform role
  (otherwise the last administrator can orphan the deployment)
an administrator cannot suspend their own account
a non-administrator receives 404, not 403, from every admin route
  — a 403 confirms the route exists and that the target id is real
```

The 404-not-403 choice deserves a comment. It is a deliberate trade: worse for debugging, better for not confirming what exists.

- [ ] **Step 6: Verify, sanitize, commit**

Run the full backend suite, lint, typecheck. Report the count of passing tests and the verbatim output of the three D7 injections.

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/apps/backend
git commit -m "feat(backend): add password recovery, the profile surface and platform administration"
```

---

## Task 13: The backend conformance drivers

**D3.** The backend drives all four shared suites and the one security suite against its real services. Until this task, core's suites have only ever been satisfied by reference implementations written in the same file that asserts them.

**Files:**
- Create: `template/apps/backend/src/users/__tests__/users.conformance.spec.ts`
- Create: `template/apps/backend/src/identities/__tests__/identities.conformance.spec.ts`
- Create: `template/apps/backend/src/auth/__tests__/auth.conformance.spec.ts`
- Create: `template/apps/backend/src/auth/__tests__/auth.security.conformance.spec.ts`
- Create: `template/apps/backend/src/audit/__tests__/audit.conformance.spec.ts`
- Create: `template/apps/backend/src/common/testing/{InMemoryRepository.ts,makeIdentityWorld.ts,index.ts}`

**Interfaces:**
- Consumes: `runIUserServiceContract`, `runIIdentityServiceContract`, `runIAuthServiceContract`, `runIAuthServiceSecurityContract`, `runIAuditServiceContract`; the four services from Tasks 11–12.
- Produces: nothing later tasks import. It is a gate.

- [ ] **Step 1: Build the in-memory repository harness**

The services are driven with real logic and fake persistence: an `InMemoryRepository<T>` implementing the slice of TypeORM's `Repository` the services actually use — `find`, `findOne`, `save`, `update`, `delete`, `count`, and a `manager.transaction` that simply runs the callback.

Be honest about what this does not cover, in a comment at the top of the file: the fake transaction does not roll back, so the atomicity Task 11 relies on for token consumption and rotation is **not** proven here. It is proven in Task 19 against a real database. A harness that silently pretends to be transactional is worse than one that says it is not.

`makeIdentityWorld()` builds the `UserServiceContractContext` — the actor, the other user and the admin — by driving the real `AuthService.register` and then verifying directly against the fake, so the world is constructed through the same code paths the application uses.

- [ ] **Step 2: Drive the four shared suites**

Each spec is thin, following the source project's established shape:

```ts
runIUserServiceContract({
  describe,
  it: it as never,
  expect: expect as never,
  makeContext: async () => makeIdentityWorld(),
});
```

Run them. Expect failures — this is the first time the real services meet the contracts, and a mismatch here is a real finding about one side or the other. For each failure, decide **which** is wrong, the contract or the implementation, and say why. A contract bent to match an implementation is not a contract.

- [ ] **Step 3: Drive the security suite**

`runIAuthServiceSecurityContract` runs against `AuthService` only. Add a comment naming DEC-1 and stating that the webapp deliberately does not drive this suite, so nobody later "fixes" the asymmetry by adding a webapp driver that proves nothing.

- [ ] **Step 4: Prove D3 discriminates**

Remove one assertion from `runIAuthServiceSecurityContract` — the one asserting that an unverified account cannot authenticate. Then break `AuthService` to allow it. Run the backend conformance spec.

**Observe that it passes.** That is D3: a suite with a missing assertion is indistinguishable from a correct implementation, and the only thing standing between the two is that someone wrote the assertion. Restore the assertion, observe the failure, restore the implementation, observe green. Record all three states.

- [ ] **Step 5: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/apps/backend
git commit -m "test(backend): drive the core conformance suites against the real services"
```

---

## Task 14: The design system and the generic component library

Stage D opens here because everything after it renders something. The source project has a mature, domain-free component library and the template ships exactly one component; importing the generic half gives a generated project a real starting point instead of a single button.

**This is an extraction task, so §12 of the spec governs it:** copy by explicit per-file allowlist, generalize, and prove zero traces. `~/Progetti/Voku` is read-only.

### Two prerequisites the import drags in, both verified before this was written

**F1 — the components depend on a design system the template does not have.** The source project's `tailwind.config.ts` **replaces** `theme.colors` wholesale with a named palette — `surface`, `backdrop`, `primary.50–900`, `neutral`, `error`, `success`, `warning` — plus a `safelist`. The template's config defines none of it: only `minHeight.touch`/`minWidth.touch`. Every imported component is written in that vocabulary (`text-primary-600`, `bg-surface`, `text-error-600`), and Tailwind emits **nothing** for a class it does not know — so the components would copy across cleanly, typecheck, lint, pass their tests and render unstyled. The failure is silent and looks like a CSS bug.

There is also `app/assets/scss/{_variables,_mixins,app}.scss`, which one candidate (`AppLogo`, via `$font-family-logo`) needs, and which requires `sass` plus the Nuxt wiring that injects it.

Consequence for what already ships: the template's `AppButton.vue` is written in stock Tailwind (`bg-slate-900`, `bg-slate-100`). Once the palette lands it becomes the one component in the library speaking a different language. Re-base it.

**F2 — the sanitize gate rejects DOM event types.** Verified by running the real `RULES` array against real component lines:

```
FAIL[source-domain type name] | function onChange(event: Event) {
FAIL[source-domain identifier] | function onSubmit(e: SubmitEvent) {
pass                           | const model = defineModel<string>();
pass                           | base.push('pointer-events-none opacity-50');
```

The bare DOM `Event` type matches `/\bEvent(?!ual)/`, and every specific interface — `SubmitEvent`, `InputEvent`, `KeyboardEvent` — matches `/[a-z](Event|Payment|Ticket)/` on the lowercase letter preceding the capital. Five of the candidate atoms (`AppInput`, `AppTextarea`, `AppSelect`, `AppCheckbox`, `AppColorPicker`) type their handlers this way.

The two rules cannot tell a DOM `Event` from the source project's `Event` entity — lexically they are the same string, and that is not a defect in the rules. **Do not weaken them.** The resolution is that the template does not name DOM event types: the affected atoms are converted to `defineModel<T>()`, which Vue 3.5 supports, eliminates the handler entirely, and is better code than what is being replaced. `pointer-events-none` is unaffected and needs no change.

If you find a candidate that genuinely needs a DOM event type and cannot use `defineModel`, **report it** rather than adding a `sanitize:allow`. Phase 1 left exactly one exemption and a standing instruction to tighten the marker to per-rule granularity before the count reaches two.

### What comes across, and what does not

**Import — atoms (31, plus the `AppButton` already present):**

`AppAlert`, `AppAvatar`, `AppBadge`, `AppCard`, `AppCheckbox`, `AppContainer`, `AppDivider`, `AppGrid`, `AppHeading`, `AppIcon`, `AppImage`, `AppInput`, `AppLink`, `AppLogo`, `AppOverlay`, `AppProgressBar`, `AppRadioGroup`, `AppSection`, `AppSelect`, `AppSpinner`, `AppStack`, `AppSurface`, `AppTab`, `AppTable`, `AppTableBody`, `AppTableCell`, `AppTableHead`, `AppTableRow`, `AppText`, `AppTextarea`, `AppToggle`

**Import — molecules (3):** `AppTabGroup`, `ConfirmDialog`, `FormField`
**Import — templates (1):** `AuthTemplate`

**Deferred to Task 17, not skipped:** `UserMenu` and `AppHeader` both call `useAuth()`, which Task 16 ships. Under Nuxt auto-imports that is a hard dependency, not a soft one — the composable would not exist, `nx typecheck webapp` would fail, and any spec mounting them would throw a `ReferenceError`. They are imported in Task 17, after the store exists. Nothing in this task's set touches auth state.

**Leave behind — niche rather than domain-coupled:** `AppColorPicker`, `AppColorSwatch` (only meaningful for a theming feature that does not exist here) and `AppMapEmbed` (a mapping integration a generated project has no reason to inherit). None is a domain leak; they are simply not a starting point. Say so in the commit message so the decision is legible.

**Leave behind — domain-coupled, all of them:** every `Event*`, `Ticket*`, `Payment*`, `Refund*`, `Rsvp*`, `Invitation*`, `Guest*`, `Series*`, `CostItem*`, `Organizer*`, `Provider*`, `*ModeDialog`, `OnlineCheckoutSection`, `MarkItemsPaidDialog`, `RecurrenceSelector` and `EventPageTemplate`. These are the source project's product, not its scaffolding.

**Files:**
- Create: `template/apps/webapp/app/components/atoms/*.vue` (31)
- Create: `template/apps/webapp/app/components/molecules/{AppTabGroup,ConfirmDialog,FormField}.vue`
- Create: `template/apps/webapp/app/components/templates/AuthTemplate.vue`
- Create: `template/apps/webapp/stories/{atoms,molecules}/*.stories.ts`
- Create: `template/apps/webapp/app/assets/scss/{_variables.scss,_mixins.scss,app.scss}`
- Modify: `template/apps/webapp/tailwind.config.ts`, `nuxt.config.ts`, `package.json`, `app/locales/en.json`
- Modify: `template/apps/webapp/app/components/atoms/AppButton.vue` (re-base onto the palette)
- Delete: the `molecules/` and `templates/` `.gitkeep` files (`organisms/` stays empty until Task 17)
- Modify: `template/package-lock.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the component vocabulary Tasks 16 and 17 build on — `AuthTemplate` wraps the login and register pages, `FormField` + `AppInput` compose every form, `AppAlert` carries the one fixed login-failure message, `ConfirmDialog` guards account deletion, `AppTable*` renders the session list.

- [ ] **Step 1: Import the design system first, and prove it took effect**

Copy the palette and `safelist` into `template/apps/webapp/tailwind.config.ts`, keeping the existing `minHeight`/`minWidth` touch tokens. Copy the three SCSS files, add `sass` to `devDependencies`, and wire it in `nuxt.config.ts` exactly as the source project does — read its config rather than guessing at the injection syntax.

Prove it before importing a single component: add a throwaway element using `bg-primary-600` and `text-surface`, run `npx nx build webapp`, and confirm the utilities appear in the emitted CSS. Then remove it. An import on top of a palette that is not actually in effect produces 37 silently unstyled files.

- [ ] **Step 2: Re-base `AppButton` and watch its test still pass**

Rewrite its `primary`/`secondary` classes in palette terms. Its existing spec asserts on class names, so it will fail — update the spec to the new classes, and keep both directions of the two assertions Phase 1 added (the suite must still catch a component that ignores `disabled` or returns both variant class sets).

- [ ] **Step 3: Copy the atoms by explicit allowlist**

One `cp` per file from the list above — never `cp -r` of the directory, which is how the excluded components come along by accident. After copying, sweep for traces with **substring** matching, not word boundaries:

```bash
cd /Users/sinisimattia/Progetti/forge/template/apps/webapp
grep -rniE 'voku|event|ticket|rsvp|payment|refund|invitation|organizer|stripe' app/components/ stories/
```

Triage every hit by hand. `pointer-events-none` and a DOM `Event` are not domain leaks; `EventCard` or `eventId` would be. Phase 1's log records this exact grep being written with `\b` and missing three real leaks, so use the substring form and read the output.

- [ ] **Step 4: Convert the five form atoms to `defineModel`**

`AppInput`, `AppTextarea`, `AppSelect`, `AppCheckbox` (and `AppColorPicker` if you chose to keep it) replace their `defineProps`/`emit`/handler triple with:

```ts
const model = defineModel<string>();
```

and bind `v-model="model"` on the native element. The `modelValue` prop and `update:modelValue` emit disappear, which is API-compatible for every caller using `v-model`. Update each component's story and any spec that reached for the old emit.

Then run `npm run sanitize` and confirm zero hits. This is the step F2 exists for; if it still trips, the conversion is incomplete.

- [ ] **Step 5: Import the molecules and the template**

Copy the four, and confirm each one's imports resolve to components that were actually imported — a molecule reaching for an atom left behind fails typecheck, which is the good outcome, but a molecule reaching for one that exists under a *different* name fails silently at runtime.

- [ ] **Step 6: Import the stories**

The source project ships a story for nearly every generic atom, plus `ConfirmDialog` and `FormField`. Import the ones matching imported components (leave `AppHeader.stories.ts` for Task 17); W5 is satisfied for free. Four imported atoms have no story upstream (`AppTab`, `AppTableBody`, `AppTableCell`, `AppTableHead`) — write them, following the existing `AppButton.stories.ts` shape.

**The Storybook build is known broken** and this task does not fix it. Stories must be correct; they will not be built. If `build-storybook` starts working, that is new evidence about a root cause currently unknown — report it, do not chase it.

- [ ] **Step 7: Import the locale keys the components reference**

Copy only the keys the imported components actually reference into `app/locales/en.json` (`AppHeader`'s `common.nav.*` and the `UserMenu` key belong to Task 17), and grep the components for every `t('...')` call to be sure none is left pointing at a key that does not exist — a missing key renders as the key itself, in the UI, in production.

- [ ] **Step 8: Verify the whole webapp, including the review dimensions**

```bash
npx nx lint webapp && npx nx typecheck webapp && npx nx test webapp && npx nx build webapp
```

Then run W1–W8's signals over the imported tree and triage by hand. W1 matters most here: with `molecules/` and `templates/` now populated, its greps run against real directories for the first time — until now they exited 2 with "No such file or directory", which reads like a clean result unless someone checks the exit code. Confirm each of the three greps now returns a real result, and construct one synthetic violation (an atom importing an atom) to watch the signal fire.

- [ ] **Step 9: Sanitize, verify the source project, commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run refresh-lockfile
npm run sanitize
git -C ~/Progetti/Voku status --porcelain     # must be empty
git -C ~/Progetti/Voku rev-parse --short HEAD # must be fdfdbde
git add template/apps/webapp template/package-lock.json
git commit -m "feat(webapp): add the design system and the generic component library"
```

Commit the palette and SCSS separately from the components if it helps a reviewer see the two halves; one commit is fine if it does not.

---

## Task 15: Webapp services and the shared conformance suite

The other half of DEC-1: the same contracts, implemented over the wire, driven by the same shared suites under vitest.

**Files:**
- Create: `template/apps/webapp/app/fetchers/{auth.fetchers.ts,user.fetchers.ts,identity.fetchers.ts,index.ts}`
- Create: `template/apps/webapp/app/services/{auth.service.ts,user.service.ts,identity.service.ts,index.ts}`
- Create: `template/apps/webapp/app/services/__tests__/{auth.service.conformance.spec.ts,user.service.conformance.spec.ts,identity.service.conformance.spec.ts,stubBackend.ts}`
- Modify: `template/apps/webapp/app/types/` (the API error shape)
- Modify: `template/apps/webapp/nuxt.config.ts` (`apiBase` runtime config, if not already present)

**Interfaces:**
- Consumes: `IAuthService`, `IUserService`, `IIdentityService` and the `*JSON` wire shapes from core; the `UserResponseDto` shape Task 12 produces.
- Produces: `AuthHttpService implements IAuthService`, `UserHttpService implements IUserService`, `IdentityHttpService implements IIdentityService`; `stubBackend()`, which Task 17's component tests reuse.

- [ ] **Step 1: Write the fetchers**

One function per endpoint, each doing nothing but issue the request and return the parsed body. The only place in the webapp where a path is spelled. `credentials: 'include'` on every auth-path request, or the refresh cookie never travels (DEC-3).

W2 forbids components calling fetchers: the chain is fetcher → service → composable → component. The services in this task are the second link.

- [ ] **Step 2: Write the services**

Each service maps the wire shape to core entities via `fromJSON` and maps error responses to the core error classes. That mapping is the service's real job and the reason the shared suite can assert the same things on both sides:

```ts
/**
 * Implements the core contract over the wire.
 *
 * Two responsibilities, and no others: turn a response into the entity the
 * contract promises, and turn a failure into the error the contract names. A
 * caller of this service cannot tell it from the other implementation, which
 * is what the shared conformance suite exists to keep true.
 */
export class AuthHttpService implements IAuthService {}
```

`authenticate()` is where DEC-3 becomes visible. The response body carries the core-shaped outcome **and** an access token beside it. The service takes the token out, hands it to the caller through the return of a separate, webapp-only method, and returns exactly the core `AuthenticationOutcome`. Core never learns a token existed. Write this seam carefully — it is the single place the two worlds touch, and a shortcut here (returning the token inside the outcome) would put transport vocabulary into a core type.

Renewal is **not** on the service, because it is not on the contract (Task 6). It is a fetcher the store calls.

- [ ] **Step 3: Write the backend stub, and be honest in its header about what it proves**

`stubBackend.ts` fakes the wire, in the exact response shapes Task 12's DTOs produce. Its file header must say plainly:

```
This stub is a model of the backend, not the backend. It proves that the
webapp's services parse what the backend produces and map errors as the
contract requires. It proves nothing about whether the backend behaves
correctly — that is the backend's own conformance run and the end-to-end
walk. When the two disagree, the stub is what is wrong.
```

That paragraph is the difference between DEC-1 being a design and DEC-1 being a comment nobody read.

- [ ] **Step 4: Drive the three shared suites**

Mirror the source project's pattern: create the stub **once per `makeService()` call**, not per request, so an in-memory map survives the several calls one test makes. Getting this wrong makes round-trip assertions fail in a way that looks like a service bug — the source project's own conformance spec carries a comment about it for exactly this reason.

Run `npx nx test webapp`. Expect failures on the first run wherever the stub and the real DTOs disagree; each one is a genuine finding about a mismatch between Task 12 and this task.

- [ ] **Step 5: Prove the webapp suite discriminates**

1. Break `UserHttpService` so it returns the raw JSON instead of a `User` entity → the suite must fail.
2. Break the error mapping so a 404 surfaces as a generic error rather than `UserNotFoundError` → the suite must fail.
3. Change the stub's response shape to drop a field → the round-trip assertion must fail, proving the stub and the contract are actually coupled.

Record all three.

- [ ] **Step 6: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/apps/webapp
git commit -m "feat(webapp): implement the core contracts over the wire and drive the shared suites"
```

---

## Task 16: The auth store, composables, middleware and the SSR re-mint

DEC-3's consequence, handled rather than discovered. The access token lives in memory, so a full page load starts with nothing and must renew during SSR, forwarding the incoming cookie by hand.

**Files:**
- Create: `template/apps/webapp/app/stores/auth.ts`
- Create: `template/apps/webapp/app/composables/{useAuth.ts,useCurrentUser.ts,index.ts}`
- Create: `template/apps/webapp/app/middleware/{auth.ts,guest.ts}`
- Create: `template/apps/webapp/app/plugins/auth-init.server.ts`
- Create: `template/apps/webapp/app/utils/authFetch.ts`
- Modify: `template/apps/webapp/package.json` (`pinia`, `@pinia/nuxt`), `nuxt.config.ts`
- Modify: `template/package-lock.json`
- Test: `template/apps/webapp/app/stores/__tests__/auth.spec.ts`
- Test: `template/apps/webapp/app/middleware/__tests__/{auth.spec.ts,guest.spec.ts}`

**Interfaces:**
- Consumes: the three services from Task 15; the refresh fetcher.
- Produces: `useAuthStore()` with `accessToken`, `currentUser`, `isAuthenticated`, `login()`, `logout()`, `renew()`, `initialize()`; `useAuth()`; `useCurrentUser()`; the `auth` and `guest` route middleware Task 17's pages declare.

- [ ] **Step 1: Write the store**

State: `accessToken: string | null`, `currentUser: User | null`, `status: 'unknown' | 'authenticated' | 'anonymous'`.

The three-state `status` matters. A boolean cannot distinguish "not signed in" from "not yet asked", and the difference is the whole user experience of a page load: with a boolean, every protected page flashes its signed-out state for one frame before the renewal resolves. Name the states and make the middleware wait on `unknown`.

`renew()` must be **idempotent under concurrency**: several components mounting at once must produce one renewal, not several. Keep the in-flight promise in the store and return it to every caller. Without this, a page with three protected widgets fires three renewals, two of which present a credential that the first has already rotated — and Task 11's reuse detection then correctly revokes the session. **This is the single most likely way DEC-3 goes wrong in practice**, and it presents as "users get logged out at random".

- [ ] **Step 2: Write the SSR plugin**

`auth-init.server.ts` runs once per request on the server, forwards the incoming cookie header to `POST /auth/refresh`, and seeds the store. Two things to get right:

- Forward the cookie explicitly. Nuxt's server-side `$fetch` does not carry the browser's cookies by default; a renewal that silently goes out without one always returns 401, and the symptom is "SSR never sees a signed-in user" with no error anywhere.
- Relay the `Set-Cookie` from the renewal back to the browser, or SSR rotates the credential, keeps the new one on the server, and the browser is left holding one that reuse detection will now treat as an attack. This is the second most likely way DEC-3 goes wrong, and it looks identical to the first from the user's side.

Write both reasons as comments. Someone will simplify this file.

- [ ] **Step 3: Write `authFetch`**

One wrapper that attaches the access token, and on a 401 renews once and retries once. Exactly once: a retry loop against an expired session is an infinite loop against your own backend.

- [ ] **Step 4: Write the middleware**

`auth` — waits for `status !== 'unknown'`, then redirects to `/login?redirect=<path>` when anonymous. `guest` — the inverse, for the login and register pages.

The redirect target must be validated as a **local path** before it is used. An unvalidated `?redirect=` is an open redirect, and a login page is the highest-value place to have one. Assert it: `/account` is accepted, `https://elsewhere.example/x` and `//elsewhere.example/x` are both rejected and fall back to the default. The protocol-relative form is the one people forget.

- [ ] **Step 5: Test the store and middleware**

```
store
  login() stores the token and the user, and sets status to 'authenticated'
  logout() clears both and sets status to 'anonymous'
  renew() called three times concurrently issues exactly ONE request   <- the flake
  renew() failing sets status to 'anonymous' rather than leaving 'unknown'
  the access token is never written to localStorage or a cookie — assert
    that neither was touched, because "in memory" is the decision and a
    later convenience commit is what would break it
middleware
  auth redirects an anonymous visitor to /login with the path preserved
  auth waits while status is 'unknown' rather than redirecting
  guest redirects an authenticated visitor away from /login
  the redirect parameter rejects an absolute URL and a protocol-relative one
```

- [ ] **Step 6: Watch the concurrency test fail**

Make `renew()` not memoize its in-flight promise. Run the store spec. **Observe three requests where one was asserted.** Restore and confirm. This is the assertion that protects against the "random logouts" failure, and it is the one that would never have been written by looking at the happy path.

- [ ] **Step 7: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run refresh-lockfile
npm run sanitize
git add template/apps/webapp template/package-lock.json
git commit -m "feat(webapp): add the auth store, middleware and the server-side session renewal"
```

---

## Task 17: Auth pages, components, stories and locale strings

The surface a person actually touches. Every component carries a story (W5) and every string is translated (W6).

**Build on Task 14's library rather than around it.** `AppInput`, `AppAlert`, `AppCard`, `AppStack`, `AppText`, `AppHeading`, `FormField`, `ConfirmDialog`, `AppTable*` and `AuthTemplate` already exist. This task adds only what is genuinely new: one molecule and four auth organisms. If you find yourself writing an atom, stop — either it was left behind for a stated reason (`AppColorPicker`, `AppColorSwatch`, `AppMapEmbed`) or the library already has it under another name.

**Also lands here, deferred from Task 14:** `UserMenu` and `AppHeader`, with their stories and the `common.nav.*` locale keys. Both call `useAuth()`, which exists only from Task 16, so importing them earlier would have failed typecheck outright. Two adaptations are needed rather than a rename:

- **`UserMenu`** reads `user.firstName` and `user.lastName`. This phase's `User` carries a single `displayName` (Task 4). Adapt it, and derive initials from `displayName` rather than inventing name fields the entity does not have.
- **`AppHeader`** links to `/login` and `/register` and renders `UserMenu` behind `isAuthenticated`. Both routes exist by the end of this task; confirm it references no route this phase does not ship.

**Files:**
- Create: `template/apps/webapp/app/components/molecules/{PasswordField.vue,UserMenu.vue}`
- Create: `template/apps/webapp/app/components/organisms/{AppHeader.vue,LoginForm.vue,RegisterForm.vue,SessionList.vue,IdentityList.vue}`
- Delete: `template/apps/webapp/app/components/organisms/.gitkeep`
- Create: `template/apps/webapp/app/pages/{login.vue,register.vue,verify-email.vue,forgot-password.vue,reset-password.vue}`
- Create: `template/apps/webapp/app/pages/account/{profile.vue,security.vue,sessions.vue,identities.vue}`
- Create: `template/apps/webapp/app/layouts/auth.vue` (wraps `AuthTemplate`)
- Create: `template/apps/webapp/stories/{molecules,organisms}/*.stories.ts` (one per component this task creates)
- Modify: `template/apps/webapp/app/locales/en.json`
- Test: `template/apps/webapp/app/components/__tests__/*.spec.ts`

**Interfaces:**
- Consumes: `useAuth`, `useCurrentUser`, the services, the middleware.
- Produces: the routes Task 19's e2e walks.

- [ ] **Step 1: Write `PasswordField` and its story**

Follow the imported library's conventions, not `AppButton`'s alone. `PasswordField` is a molecule composing `FormField` with a visibility toggle, and it shows the policy violations core's `evaluatePassword` returns — so the rule a person sees while typing is the rule the server applies. It must not re-derive the rule locally; that is the second copy the shared policy exists to prevent.

W1: a molecule may import atoms and nothing at its own level or above.

- [ ] **Step 2: Write the pages**

Every page sets `useHead` (W7). Every interactive element is a real `<button>` or `<a>` (W8). Every visible string comes from `en.json` (W6).

Three pages need care beyond the ordinary:

- **`login.vue`** — the failure message is one fixed string for every failure. The UI must not develop its own opinion about *why* a login failed; D7 is undone as easily by a helpful error message as by a different status code. Write the comment.
- **`verify-email.vue`** — handles three distinct outcomes (verified, already used, expired) and offers "send it again" for the last two. Each needs its own string.
- **`reset-password.vue`** — after a successful reset, every session is gone (Task 12), including any the person had open elsewhere. Say so on the page. A silent mass logout reads as a bug.

- [ ] **Step 3: Component tests that can fail**

Phase 1 found an `AppButton` suite that could not catch an implementation ignoring its `disabled` prop, because no test asserted absence. Do not repeat it. For each component assert both directions:

```
LoginForm
  submits the normalized address and the secret
  shows the single fixed failure message on rejection
  does NOT show a different message for a different rejection — drive two
    distinct failures and assert the rendered text is identical
  disables submit while in flight, and re-enables after failure
SessionList
  renders one row per session
  marks the current session and does NOT offer to revoke it
  calls revoke with the right id
PasswordField
  shows a violation for a short secret and none for a compliant one
IdentityList
  hides the unlink control when only one identity remains
```

The `does NOT` assertions are the ones that catch a real regression. A test that only asserts what should appear passes against a component that shows everything.

- [ ] **Step 4: Stories**

One story file per component **this task creates** — the five new ones; Task 14 brought the library's own. `satisfies Meta<typeof X>` with `type Story = StoryObj<typeof meta>`, importing via the `~/components/...` alias.

**The template's Storybook build is known broken** (`[vite:build-html] Missing field 'moduleType'`) and it is not this task's job. Write the stories correctly and move on. If `build-storybook` happens to start working, say so — that would be new evidence about a root cause that is currently unknown.

- [ ] **Step 5: Verify the review dimensions**

Run each of W1–W8's signals over the new files and triage every hit by hand. W6 over-surfaces by design — read each match rather than treating it as a violation.

- [ ] **Step 6: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/apps/webapp
git commit -m "feat(webapp): add the authentication and account pages"
```

---

## Task 18: The generated-project gates

Forge's own integration tier, extended to the new surface. Phase 1's gate test proved a generated project passes `lint`, `typecheck`, `test`, `build` and `purity`; it now has roughly ten times as much to prove it against.

**Files:**
- Modify: `tests/integration/generated-project.test.mjs`
- Modify: `tools/sanitize.mjs` (only if Task 8 or 10 established a genuine need — see Step 3)
- Modify: `.github/workflows/ci.yml` (forge's own)
- Modify: `README.md`

**Interfaces:**
- Consumes: the whole template.
- Produces: the gate that says Phase 2 is real.

- [ ] **Step 1: Extend the inventory assertion**

The existing assertion lists a handful of process-layer paths. Add the load-bearing new ones: the four platform ADRs, the four core domain folders' `contracts/` barrels, the three migrations, the mail port, and the auth pages. Do not list every file — the inventory exists to catch a whole missing area, and a list of 300 paths is a list nobody updates.

Add one assertion Phase 1 did not have, because it is cheap and catches a real class of mistake:

```js
// Every subpath in libs/core's `exports` must resolve to a real barrel on disk.
// A subpath added to package.json but not created — or created and not added —
// fails here rather than in whichever consuming task imports it next.
```

Walk `libs/core/package.json` `exports`, map each key to `libs/core/src/<key>/index.ts`, and assert existence in both directions: no export without a barrel, and no domain folder barrel without an export.

- [ ] **Step 2: Watch the gate get slower and decide what to do about it**

Time the gate run. Phase 1's was ~125 seconds inside the generated project. Report the new figure and the per-target breakdown. If it has grown past roughly five minutes, say so and propose a split rather than silently accepting a suite people will start skipping — but **do not** split it on your own initiative; the whole value of this test is that it runs.

- [ ] **Step 3: Re-run sanitize against the whole new surface, and triage honestly**

Phase 2 adds a great deal of text containing `password`, `secret`, `token` and `key`. The populated-secret rule matches `KEY=value` and `KEY: value`, case-insensitively, after stripping `${...}` interpolations.

Run `npm run sanitize` and triage every hit by hand:
- A genuine populated credential: fix the file.
- A false positive on prose or a DTO field: **report it and propose the narrowest possible rule change.** Do not add `# sanitize:allow` to make it quiet — Phase 1 left exactly one exemption and a standing instruction to tighten the marker to per-rule granularity if the count ever exceeds one.

Phase 1's log records two rule changes that were made and one (`CREDENTIALS?`) that was proposed and correctly rejected for false-positiving on a CORS flag. Expect to be in that territory again.

- [ ] **Step 4: Add a discriminating test for the new surface**

Extend the existing D2/D14 probe with two injections that Phase 2 makes possible for the first time:

```
inject `import { Repository } from 'typeorm'` into libs/core/src/auth/entities/Session.ts
  -> npx nx lint core must fail                                     (D2, new domain)
inject the TSDoc line "Returns the JWT carried in the session cookie"
  into libs/core/src/auth/contracts/IAuthService.ts
  -> npm run purity -w libs/core must fail on BOTH terms            (D14, new domain)
```

Both must be observed failing and then observed clean again after the probe file is restored. Phase 1 verified these against `shared/`; verifying them against a real domain file is what proves the guard covers the tree rather than the one folder it was written against.

- [ ] **Step 5: Update forge's own CI and README**

`ci.yml` — the generated-project tier now takes appreciably longer; check the job timeout is still adequate and report the new wall-clock. Leave the storybook job non-blocking and its comment unchanged.

`README.md` — update the file tree, the description of what a generated project contains, and the D-test table. Every claim in the README must be re-verified against the live repo, not copied forward: Phase 1's reviewer independently re-checked every README claim and found no drift, and that is the bar.

- [ ] **Step 6: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize && npm test
git add tests README.md .github tools
git commit -m "test(forge): extend the generated-project gate to the identity surface"
```

---

## Task 19: The Docker end-to-end identity walk

The stack, running, doing the whole thing. **D13 can only be proven here** — and D6, D7 and D8 are re-proven against the real database rather than against fakes.

**Files:**
- Modify: `tests/integration/docker.test.mjs`

**Interfaces:**
- Consumes: the generated project, Docker, the mail outbox from Task 10.
- Produces: the evidence that Phase 2 works.

- [ ] **Step 1: Re-read the Phase 1 e2e before changing it**

It already solves three problems you must not reintroduce:
- **Free ports, always.** It asks the OS for four. This machine has an unrelated Postgres on 5432 and unrelated containers that must never be touched. Do not hardcode a port and do not stop anything.
- **A per-run compose project name** (`-p forge-e2e-<suffix>`), threaded through `up`, `ps`, `logs` and `down` by one helper so they cannot drift. A `down` that disagrees with `up` tears down nothing, silently.
- **Diagnostics on failure** — `ps` and `logs` are attached, so a failure is diagnosable rather than a bare timeout.

Keep all three. Add the new environment variables (`APP_DB_ROLE`, `APP_DB_PASSWORD`, `MIGRATION_DATABASE_URL`, `MAIL_OUTBOX_DIR`, `PUBLIC_WEBAPP_URL`) to the run.

- [ ] **Step 2: Walk the identity flow**

```
POST /auth/register                       -> 202
read the mail outbox, extract the verification link             (Task 10)
GET  /users/me with no credential         -> 401                <- D6
POST /auth/login before verifying         -> 401
POST /auth/verify-email with the token    -> 204
POST /auth/login                          -> 200, access token + Set-Cookie
GET  /users/me with the access token      -> 200, the right user
PATCH /users/me                           -> 200, the profile changed
GET  /users/me/sessions                   -> exactly one session
POST /auth/refresh with the cookie        -> 200, a NEW cookie
GET  /users/me with the NEW access token  -> 200
POST /auth/refresh with the OLD cookie    -> 401                <- D8
GET  /users/me with the NEW access token  -> 401 (the family is gone)  <- D8
POST /auth/login again                    -> 200
POST /auth/forgot-password (known)        -> 202
POST /auth/forgot-password (unknown)      -> 202, byte-identical body  <- D7
read the outbox, reset the password       -> 204
the pre-reset access token                -> 401 (sessions revoked)
```

Compare the two `forgot-password` responses to **each other**, as in Task 12. The e2e is where D7 is proven against the real stack rather than against a controller with fake services.

- [ ] **Step 3: Prove D13 at the database**

Connect to the running Postgres **as the application role** — the same credential the backend uses, taken from the compose environment, not the owner:

```bash
docker compose -p "$PROJECT" exec -T postgres \
  psql "postgresql://<app-role>:<app-password>@localhost:5432/<db>" \
  -c "UPDATE audit_entries SET action = 'TAMPERED' WHERE true;"
```

Assert the command **fails** with `permission denied for table audit_entries`, and the same for `DELETE`. Then assert that `SELECT` returns the login entries the walk above produced and that an `INSERT` succeeds — the table must be append-**only**, not read-only.

Then the assertion that makes it a guarantee rather than a configuration detail:

```bash
# as the app role — it must not be able to grant itself the privilege back
psql ... -c "GRANT UPDATE ON audit_entries TO CURRENT_USER;"
```

Assert this fails too. If it succeeds, D13 is decorative and Task 8's design is wrong; report it as a blocking finding rather than adjusting the test.

- [ ] **Step 4: Prove the walk discriminates**

An end-to-end test that only ever runs green proves nothing about itself. Inject, observe, restore — recording verbatim output for each:

1. Remove the `REVOKE` from the audit migration, rebuild, re-run → the D13 assertions must fail.
2. Remove the reuse branch from `RefreshTokenService` → the D8 assertions must fail.
3. Add a `message` field to the unknown-address `forgot-password` response → the D7 comparison must fail.
4. Mark `GET /users/me` `@Public()` → the D6 assertion must fail.

This is four full rebuild-and-run cycles and it is the most expensive step in the plan. It is also the only thing that turns a green e2e into evidence. Do not skip it, and do not substitute reasoning for running it.

- [ ] **Step 5: Verify the machine is as you found it**

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
docker volume ls --filter name=forge-e2e
git -C ~/Progetti/Voku status --porcelain
git -C ~/Progetti/Voku rev-parse --short HEAD
```

Report all four. The unrelated containers must be running with their uptimes intact; Voku must be clean at `fdfdbde`. A killed run leaves one inert `forge-e2e-*_pgdata` volume behind by design — a visible leftover beats a silent reuse — so note any you created.

- [ ] **Step 6: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge
FORGE_E2E=1 npm run test:integration
npm run sanitize
git add tests
git commit -m "test(forge): walk the identity flow end to end and prove the audit log is append-only"
```

---

## Task 20: Fix wave, decision log, roadmap

Phase 1 closed with a single fix-wave dispatch and a preserved decision log, and both are why this plan could be written at all. Do the same.

**Files:**
- Create: `docs/superpowers/phase-2-decision-log.md`
- Modify: `docs/superpowers/phase-roadmap.md`
- Modify: whatever the wave fixes.

- [ ] **Step 1: Triage everything deferred during the phase**

Sort every parked item into: fix now, leave documented with a reason, or out of phase and named so it is not lost. Phase 1's triage put 21 items into those three buckets and fixed 11; use the same test — **does this affect a real user of a generated project?**

- [ ] **Step 2: Carry the Phase 1 items this phase touched**

Several Phase 1 parked items sit in files Phase 2 rewrites. Check each and fix it if you are already in the file:
- `planner.md` describing a flat `libs/core/entities/` layout while the shipped convention is per-domain. Phase 2 creates four per-domain folders, so a planner proposing a flat layout is now actively wrong in a way a generated project will hit immediately.
- `backend-tester.md`'s self-provisioning e2e paragraph not naming `supertest`. Task 11 adds `supertest` as a real dependency, so this can now simply point at it.
- W1's signal missing same-level imports, and W6's `{2,}` interval.

- [ ] **Step 3: Write the decision log**

Same shape as Phase 1's: what was decided, why, and what it costs if the decision was wrong. It must include, at minimum:
- Every ruling made during execution.
- The `clientAddress`/`clientLabel` departure from the spec's `ip`/`userAgent` (Task 6), so Mattia can overrule it.
- The enumeration-safe `register()` (Task 11), which goes beyond what the spec requires.
- The hashing-library decision from Task 9's probe and the evidence behind it.
- Every case where this plan's prescription was wrong and an implementer caught it — that list is the most valuable part of the Phase 1 log and the reason this one exists.
- A "five worth knowing before you touch the code" section at the top.

- [ ] **Step 4: Update the roadmap**

Mark Phase 2 **BUILT**. State what Phase 3 inherits: the `policies/` folder for `can()`, the nullable `organizationId` already on `AuditEntry`, `PlatformRole` as the first of the three authorization layers, and the conformance split from DEC-1. Add any ordering decision Phase 2 discovered that Phase 3 must not get wrong.

- [ ] **Step 5: Final verification, then commit**

Run everything: `npm run sanitize`, `npm test`, `FORGE_E2E=1 npm run test:integration`, and the full gate inside a freshly generated project. Report each result with its verbatim output. Confirm Voku is clean at `fdfdbde` and the unrelated containers are untouched.

```bash
git add docs
git commit -m "docs(forge): preserve the phase-2 decision log and mark the phase built"
```

---

## Phase 2 Definition of Done

- [ ] `npm run create -- --name my-app` produces a project that passes `lint`, `typecheck`, `test`, `build` and `purity`.
- [ ] `npm run sanitize` is clean, with no more deliberate exemptions than Phase 1 left behind, or with every new one justified in the decision log.
- [ ] Both apps implement `IUserService`, `IIdentityService` and `IAuthService`, and the shared conformance suites pass under jest **and** vitest.
- [ ] The backend-only security suite passes against the real `AuthService`.
- [ ] `FORGE_E2E=1 npm run test:integration` walks register → verify → login → renew → reuse → reset → audit against the running stack.
- [ ] **D3, D6, D7, D8, D13 and D14 are implemented and each has been observed to fail when its fault is injected**, with the verbatim output recorded.
- [ ] `libs/core` names no framework and no transport concept, in imports or prose.
- [ ] `git -C ~/Progetti/Voku status --porcelain` is empty and `HEAD` is still `fdfdbde`.
- [ ] Every Docker container this machine was running before the phase is still running, untouched.

**Not in this phase, and deliberately:** D9 (tenant isolation), D12 (grant revocation) and D15 (last owner) need organizations — Phase 3. D10 (MFA challenge) needs Phase 5. D11 (OAuth email-match linking) needs Phase 4. The Storybook build remains broken with an unknown root cause.

## Next

Plan 3 — Organizations and authorization: `Organization`, `Membership`, `Invitation`, `ROLE_PERMISSIONS` and `can()` as pure core logic in `policies/`, `PermissionsGuard` + `@RequirePermission`, `useCan()` calling the same function, and the audit log's `organizationId` finally carrying a value. Discriminating tests D9, D12 and D15.
