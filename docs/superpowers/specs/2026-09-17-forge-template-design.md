# Forge — Application Template Workspace

**Status:** approved design (v2), pending implementation plan
**Date:** 2026-09-17
**Source of truth for extraction:** `~/Progetti/Voku` @ `fdfdbde` (read-only)
**Supersedes:** v1 (layered composition + minimal auth), replaced per review

---

## 1. Context

Voku is an NX/npm-workspaces monorepo whose reusable value is not its domain but its
scaffolding: a consolidated agent roster, single-source standards docs, a framework-agnostic
`libs/core` acting as an executable contract, a containerized Node 22 dev environment, and a
documented lifecycle (`planner → core-implementer → implementers → testers ‖ reviewer →
documenter → closer → pr`).

Rebuilding that by hand per application is expensive and lossy. Forge extracts it once into a
standalone template that generates new projects.

Forge is a **clean one-time snapshot**. It is not an upstream, does not sync, and never
modifies Voku.

## 2. Goals

- G1. A new application — correctly structured, fully authenticated, passing its own
  lint/typecheck/test/build gates — is one command away.
- G2. The "how we work" layer (agents, standards, docs conventions) can also be adopted into a
  repository that already exists.
- G3. Exactly one way to generate a project. No composition, no variants, no matrix.
- G4. Zero Voku domain concepts survive extraction (no Events, Tickets, Invitations/RSVP,
  Payments, refunds, Stripe, or Voku branding).

## 3. Non-goals

- N1. No changes of any kind to `~/Progetti/Voku`.
- N2. No layer system, presets, or stack variants. One template. (See §12.)
- N3. No second stack. The template is NX + NestJS/TypeORM/Postgres + Nuxt 4/Vue 3, always.
- N4. No GitHub remote creation, no push, no npm publish. Local repo only.
- N5. No drift/update tooling. A receipt is written so it stays possible; it is not built.
- N6. Forge does not dogfood its own template on itself.

## 4. Approach

**One template tree, copied wholesale.** `template/` is an ordinary, complete, bootable
monorepo. The generator copies it, substitutes tokens, and initializes git. That is the entire
mechanism.

Rejected:

- *Layered composition (v1).* Overlay directories, a dependency graph, topological sort, and
  JSON deep-merge bought the ability to mix stacks — a capability not wanted (N3). Everything
  it cost (merge semantics, seam files to avoid merging prose, a whole class of
  composition-order bugs) was pure overhead for a single fixed stack.
- *Template engine (Plop/Hygen).* Turning every file into a `.hbs` template makes the template
  unrunnable and unlintable in place — you could no longer boot it to check it still works.

Dropping layers deletes three subsystems outright: the manifest/dependency resolver, JSON deep
merge, and the seam-file indirection (`package-map.md`, `stack-roster.md`, `toolchain.md`).
With one template, the root `CLAUDE.md`, the agent playbook, and the agents README simply
state the real package table directly.

## 5. Repository layout

```
forge/
├── template/             # THE template — a complete monorepo, rooted at the target repo root
├── tools/create/         # the generator (zero runtime dependencies)
├── tests/                # unit + integration tests for the generator
├── docs/                 # forge's OWN docs (forge ADRs, this spec)
├── CLAUDE.md
└── README.md
```

## 6. Tokens

Substituted in **file contents and in path segments**, so `libs/core/package.json` holding
`"name": "__FORGE_SCOPE__/core"` generalizes `@voku/core` correctly.

| Token | Example | Source |
|---|---|---|
| `__FORGE_NAME__` | `my-app` | prompted; must match `^[a-z][a-z0-9-]*$` |
| `__FORGE_TITLE__` | `My App` | derived: title-cased from name |
| `__FORGE_SCOPE__` | `@my-app` | derived: `@` + name |
| `__FORGE_DESCRIPTION__` | `An app.` | prompted, may be empty |
| `__FORGE_DB_NAME__` | `my_app` | derived: name with `-` → `_`; `^[a-z][a-z0-9_]*$` |

After substitution the generator **fails** if any `__FORGE_[A-Z0-9_]*__` token survives.

The `__FORGE_` prefix is load-bearing. A bare `__NAME__` convention would make that guard fire
on legitimate shipped content — Nuxt's `window.__NUXT__` is the obvious casualty. Namespacing
lets the guard stay a hard failure rather than degrade to a warning.

Binary files are detected by a NUL byte in the first 8 KiB and copied verbatim, never
substituted. Extension allowlists were rejected — they surprise on unusual files.

## 7. The generator

Two modes, one template.

```
# create mode — a new project
npm run create -- --name <kebab> [--title <s>] [--scope <@s>] [--description <s>]
                  [--db-name <s>] [--out <parent-dir>] [--no-git] [--yes]

# adopt mode — the process subset into a repo that already exists (G2)
npm run create -- --into <existing-dir>
```

Zero runtime dependencies — `node:fs`, `node:path`, `node:readline/promises` on Node 22.

**Create mode pipeline:**

1. **Prompt** for anything unanswered. `--yes` takes all derivable defaults and fails on
   anything genuinely required.
2. **Stage** into a temp directory — never the target. Copy `template/` wholesale.
3. **Substitute** tokens in contents and paths; fail on any surviving `__FORGE_*__`.
4. **Commit** — refuse a non-empty target; atomically rename temp → target. A failed run
   leaves nothing behind, so there is never a half-generated repo to clean up.
5. **Seal** — write `forge.json`, then `git init` + one initial commit unless `--no-git`.
6. **Report** next steps (`npm install`, `npm run dev:up`).

`--out` defaults to the current working directory; the target is `<out>/<name>`.

**Adopt mode** copies only the **process subset** and **never overwrites**. Existing files are
skipped and listed in a closing report so you can merge them by hand. The subset is one
declared list in `tools/create/subset.mjs` — a plain array, not a manifest system:

```
CLAUDE.md
.claude/agents/**
.claude/agent-memory/**
docs/standards/**
docs/adrs/0000-template.md
docs/adrs/000{1,2,3,4}-*.md
```

`forge.json` receipt — `{ forgeCommit, generatedAt, mode, tokens{} }`. All token values are
non-secret by construction. It costs one line and keeps N5 possible later.

Exit codes: `0` success · `1` validation error · `2` target conflict · `3` internal error.

## 8. Template contents

### 8.1 Workspace shell

`package.json` (workspaces `apps/*` + `libs/*`, the NX `build`/`test`/`lint`/`typecheck`/
`affected` scripts, the `dev:*`/`prod:*` docker scripts, `engines: node >=22 <23`), `nx.json`
(target defaults + caching), `eslint.config.base.mjs`, base `tsconfig`, `.editorconfig`,
`.gitignore`, `.env.example`, `compose.yaml` + `compose.prod.yaml` (workspace + postgres),
`.github/workflows/ci.yml` (nx-affected on Node 22).

### 8.2 Agents and docs

```
CLAUDE.md                            # root orientation, real package table
.claude/agents/                      # all 11 agents + README
.claude/agent-memory/reviewer/       # .gitkeep
docs/standards/                      # README, agent-playbook, data-conventions, formatting,
                                     #   git, i18n, naming, testing, typing
docs/adrs/                           # 0000-template.md + convention ADRs 0001-0004
docs/{rfcs,architecture,guides,concepts,api}/   # skeletons, each with a README
docs/superpowers/{specs,plans}/      # where brainstorming and writing-plans land
```

The full roster carries over unchanged in shape: `planner`, `reviewer`, `documenter`,
`closer`, `pr`, `core-implementer`, `core-tester`, `backend-implementer`, `backend-tester`,
`webapp-implementer`, `webapp-tester`. Frontmatter keeps Voku's fields (`name`,
`description`, `model`, `color`, optional `memory`) and model assignments, which a generated
project is free to change.

**Reviewer.** Voku's reviewer hardcodes its dimension checklists. Forge keeps the
dimension-*selection* machinery but moves the checklists into each package's `STANDARDS.md`
under a `## Review dimensions` section:

```markdown
## Review dimensions
| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| B1 | Controllers contain no business logic | `grep -n "await this\..*Repository" src/**/*.controller.ts` | blocking | STANDARDS.md §3 |
```

This is retained from v1 even though layers are gone, on its own merit: the rules live next to
the package they govern, the reviewer prompt stays thin, and it obeys the single-source rule
the ADRs establish. It is not required by anything else in this design.

**Inherited convention ADRs**, re-authored from Voku ADRs that are reusable conventions rather
than product decisions, framed as defaults the generated project inherits and may supersede:

- `0001-single-source-documentation.md` (from Voku ADR-0008's surviving rule)
- `0002-consolidated-agent-roster.md` (from ADR-0009)
- `0003-architecture-docs-describe-boundaries.md` (from ADR-0010)
- `0004-api-reference-lives-with-implementation.md` (from ADR-0013)

Voku's product ADRs (0001–0007, 0011, 0012, 0017, 0018) do not cross over.

**Scope limit, stated honestly:** `docs/standards/*` is framework-agnostic but unmistakably
TypeScript-flavored. It is not abstracted into language-neutral prose — that would remove
everything that makes it useful.

### 8.3 `libs/core`

The framework-agnostic domain and executable contract. `src/shared/{errors,testing,types}`
(base `DomainError`, `ConformanceExpect`), `src/users/` (§9), `tests/` mirroring `src/`,
`package.json` with subpath `exports`, `tsconfig` with `verbatimModuleSyntax`, jest config,
`CLAUDE.md`, `STANDARDS.md`.

Voku's layout rules carry over verbatim: per-domain folders
(`entities/ contracts/ enums/ errors/ types/ testing/`), one file per symbol, barrel
`index.ts` per folder, subpath-only exports, specific `DomainError` subclasses, TSDoc as
definition-of-done, money as integer cents, UTC `Date` in entities and ISO-8601 on the wire.

**Purity is enforced structurally, not only by review.** Voku relies on the reviewer agent for
core purity; there is no lint rule. Forge adds `no-restricted-imports` to
`libs/core/eslint.config.mjs` banning `typeorm`, `@nestjs/*`, `nuxt`, `vue`, `pinia`, and
`@prisma/*`. The reviewer's purity dimension remains, because lint cannot check *prose* — core
must also never name its consumers in TSDoc or comments — but import purity becomes a
guarantee rather than a check that can be skipped.

### 8.4 `apps/backend`

NestJS: `src/{auth,users,common,db/migrations,health,i18n,mail}`, `Dockerfile`,
`project.json`, jest config, `CLAUDE.md`, `STANDARDS.md` (with its review-dimension table).

### 8.5 `apps/webapp`

Nuxt 4: `app/{components,composables,fetchers,services,stores,pages,layouts,locales,
middleware,utils,types}`, Storybook (atoms/molecules/organisms), Tailwind, vitest,
`Dockerfile`, `CLAUDE.md`, `STANDARDS.md` (with its review-dimension table).

## 9. Authentication and users — shipped in full

Every generated project starts with a complete, production-shaped authentication system as
real, kept code. It is also the worked example of the core-first pattern: one contract in
`libs/core`, implemented by both apps, checked by one conformance suite.

### 9.1 Core (`libs/core/src/users/`)

- **entities** — `User`
- **contracts** — `IUserService`, `IAuthService`
- **enums** — `UserRole` (`ADMIN | USER`), `UserStatus`
  (`PENDING_VERIFICATION | ACTIVE | SUSPENDED | DELETED`)
- **errors** — `UserNotFoundError`, `EmailAlreadyRegisteredError`, `InvalidCredentialsError`,
  `EmailNotVerifiedError`, `AccountSuspendedError`, `TokenExpiredError`,
  `TokenAlreadyUsedError`, `WeakPasswordError`
- **types** — `UserJSON`, `CreateUserInput`, `UpdateUserInput`, `AuthTokens`, `JwtPayload`
- **testing** — `runIUserServiceContract`, `runIAuthServiceContract`, fixtures

`UserRole` ships as `ADMIN | USER` behind a `@Roles` guard, so adding a role is a one-line
enum change rather than a new mechanism.

### 9.2 Backend flows

| Flow | Endpoints |
|---|---|
| Registration | `POST /auth/register`, `POST /auth/verify-email`, `POST /auth/resend-verification` |
| Session | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all` |
| Password | `POST /auth/forgot-password`, `POST /auth/reset-password`, `PATCH /auth/change-password` |
| Profile | `GET /users/me`, `PATCH /users/me`, `DELETE /users/me` |
| Administration | `GET /users`, `GET /users/:id`, `PATCH /users/:id/role`, `PATCH /users/:id/status` |

Mechanics: Passport `local`/`jwt`/`jwt-refresh` strategies; a globally-applied `JwtAuthGuard`
with an explicit `@Public()` opt-out (secure by default — a new endpoint is protected unless
it says otherwise); `RolesGuard` + `@Roles()`; `@CurrentUser()` decorator; argon2id password
hashing; short-lived access tokens with **rotating refresh tokens**; `@nestjs/throttler` rate
limiting on every auth endpoint.

Security properties the implementation must hold, each covered by a test in §11:

- Refresh tokens are **rotated on use**, persisted **hashed**, and revocable; presenting an
  already-used refresh token **revokes the whole family** (reuse detection).
- Verification and password-reset tokens are single-use, expiring, and stored hashed.
- Login and forgot-password return **identical responses for unknown and known emails**, so
  neither enumerates accounts.
- An unverified or suspended account cannot obtain tokens.
- Soft delete — `DELETE /users/me` sets `UserStatus.DELETED` and revokes all sessions.

**Mail is an adapter, not a vendor.** `mail/` defines an `IMailer` port with a console/dev
adapter shipped and wired. No third-party provider, no API keys, nothing to leak — a generated
project picks its provider by writing one adapter.

Migrations: initial TypeORM migration for `users`, `refresh_tokens`, `email_verification_tokens`,
`password_reset_tokens`.

### 9.3 Webapp

`app/services/{user,auth}.service.ts` implement the *same* `IUserService`/`IAuthService` over
HTTP, driven by the *same* core conformance suites. Plus `auth.fetcher.ts`/`users.fetcher.ts`,
`useAuth`/`useCurrentUser` composables, a Pinia auth store with silent refresh, route
middleware (`auth`, `guest`, `role`), pages for login, register, verify-email,
forgot-password, reset-password, `account/profile` and `account/security`, the auth form
components with Storybook stories, and `en` locale strings.

That both apps implement one contract, checked by one suite, is the distinctive property of
this architecture, and this slice exists to demonstrate it as much as to provide auth.

### 9.4 Explicitly deferred

Not shipped, listed so the boundary is visible rather than discovered later: OAuth/social
login, TOTP/WebAuthn multi-factor, organizations/teams/multi-tenancy, per-resource
permissions (beyond roles), audit logging, and account-linking.

## 10. What the generated project looks like

```
my-app/
├── CLAUDE.md, README.md, forge.json
├── package.json, nx.json, tsconfig.base.json, eslint.config.base.mjs
├── compose.yaml, compose.prod.yaml, .env.example
├── .github/workflows/ci.yml
├── .claude/agents/ (11), .claude/agent-memory/
├── docs/{standards,adrs,rfcs,architecture,guides,concepts,api,superpowers}/
├── libs/core/        → shared/ + users/ (entities, contracts, enums, errors, types, testing)
└── apps/
    ├── backend/      → auth, users, common, db/migrations, health, i18n, mail
    └── webapp/       → auth pages, services, stores, composables, middleware, stories
```

`npm install && npm run dev:up` gives a running stack where you can register, verify, log in,
refresh, and reset a password — with no domain code to delete first.

## 11. Testing

**Unit** (`tools/create/__tests__/`) — token substitution (contents, paths, binary
passthrough, unresolved-token failure), adopt-mode subset selection, and the never-overwrite
rule.

**Integration** (`tests/integration/`) — generate into a temp directory, assert the file
inventory, then run `npm install && npm run lint && npm run typecheck && npm run test &&
npm run build` *inside the generated repo*. If a generated repo cannot pass its own gates,
forge is broken, and only running them proves otherwise.

**Docker e2e** — `docker compose up -d`, then drive the real flow against the running stack:
register → verify → login → call a protected route → refresh → reuse the old refresh token
(must fail) → forgot/reset password → login with the new password. Gated behind `FORGE_E2E=1`
so the default suite needs no Docker; CI sets it.

**Discriminating (negative) tests.** A green suite is not evidence on its own; each of these
asserts a *failure* that must occur:

| # | Injected fault / probe | Must fail |
|---|---|---|
| D1 | fixture containing an unresolved `__FORGE_MISSING__` token | generation, exit 1 |
| D2 | `import { Repository } from 'typeorm'` added to `libs/core/src/` | `npm run lint` |
| D3 | an assertion removed from the `IUserService` conformance suite | the backend conformance test |
| D4 | adopt mode run against a repo with an existing `CLAUDE.md` | must skip it, leaving bytes identical |
| D5 | `grep -ri voku template/ tools/` | must return zero hits (G4) |
| D6 | a new endpoint added with no decorator | must be **401 without a token** — proves the global guard, not a per-route habit |
| D7 | login with a known email + wrong password vs. an unknown email | responses must be indistinguishable |
| D8 | a refresh token presented twice | second use rejected **and** the family revoked |

D6–D8 exist because auth that compiles and returns 200 on the happy path is not auth that
works; these are the assertions that would actually catch a regression.

CI: unit + integration on every push; the Docker e2e matrix on PRs.

## 12. Extraction procedure

Voku is read-only throughout (N1).

1. Copy **by explicit per-file allowlist**, never `cp -r` of a package. This structurally
   excludes `node_modules/`, `dist/`, `coverage/`, `.git/`, `.nx/`, `storybook-static/`, and
   any `.env`, rather than relying on ignore patterns to catch them.
2. Generalize: strip Voku domain code and naming; replace `@voku/*` and `Voku` with
   `__FORGE_SCOPE__`/`__FORGE_TITLE__`; rewrite the four convention ADRs; rewrite `reviewer`
   for table-driven dimension discovery.
3. **Extend** Voku's auth into the full system in §9. Voku's auth is the starting point, not
   the destination: its optional-guest-auth and guest-token paths (ADR-0004) and any
   event-scoped roles are removed, and verification, password reset, refresh rotation with
   reuse detection, throttling, and the mail port are added.
4. **Sanitization gate before the first content commit** — grep the staged template for `sk_`,
   `pk_live`, `SECRET=`, `PASSWORD=`, `BEGIN .* PRIVATE KEY`, and `voku` (case-insensitive).
   All must return zero hits. This is D5, run as a gate rather than only as a test.
5. **Verify the constraint:** `git -C ~/Progetti/Voku status --porcelain` must be empty and
   `git -C ~/Progetti/Voku rev-parse HEAD` must still be `fdfdbde`.

## 13. Changes from v1

1. **The layer system is gone** (N2). No `layers/`, manifests, `dependsOn`, topological sort,
   presets, or JSON deep-merge. One `template/` tree, copied wholesale.
2. **Seam files are gone.** They existed only to avoid merging prose across layers. The root
   `CLAUDE.md`, the playbook, and the agents README now state the package table directly.
3. **No `minimal` variant** (N3). The template is always the full NestJS + Nuxt monorepo.
4. **Auth ships in full** (§9) rather than as a reduced `USER | ADMIN` slice — verification,
   password reset, refresh rotation with reuse detection, throttling, admin user management,
   and a mail port.
5. **Adopt mode replaces the `process` preset** as the way to satisfy G2, via a declared path
   list rather than a layer.
6. **Retained from v1:** `__FORGE_*__` token namespacing, staging + atomic rename, the
   `forge.json` receipt, structural core-purity lint, table-driven reviewer dimensions, and
   the discriminating-test discipline (now extended with D6–D8 for auth).

## 14. Deferred

- `forge update` / drift detection (receipt written, tooling not built).
- The auth features listed in §9.4.
- Publishing forge to a remote or to npm.
