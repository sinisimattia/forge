# __FORGE_TITLE__ Backend — Agent Playbook

## Project Overview

This package is the **backend**: a NestJS REST API with TypeORM and PostgreSQL. It ships as
a skeleton with no business domain of its own. What it does ship is the identity
foundation — registration, sign-in, the session lifecycle, and a global guard that closes
every route not marked `@Public()` — and, on top of it, **organizations and authorization**:
organizations, memberships, invitations, per-record grants, and `PermissionsGuard`, which
answers every organization-scoped route through core's `can()`. Feature domains (e.g.
`articles`, `comments`, `tags`) land here once `libs/core` defines their entities and
`I*Service` contracts (see `libs/core/CLAUDE.md`).

- **Framework:** NestJS (Node.js + TypeScript)
- **ORM:** TypeORM
- **Database:** PostgreSQL
- **Package manager:** npm (workspaces)

## Where the rules live

Behavioral standards are **not** restated in this file. They live in two tiers:

- **`apps/backend/STANDARDS.md`** — backend-local rules (NestJS module layout,
  service/controller separation, DTO/class-validator, TypeORM + migrations,
  exception/i18n payload shape, Jest specifics).
- **`docs/standards/`** — shared, framework-agnostic rules
  (`naming`, `typing`, `i18n`, `testing`, `git`, `data-conventions`,
  `agent-playbook`). The shared docs live in the top-level `docs/` folder and
  are read-only reference — never edit them from within this package.
- ADRs / RFCs in `docs/` remain authoritative for their topics once they exist.

If a quick-reference below and a standards doc (or an ADR/RFC) disagree, the
canonical doc wins — the tables here only orient a reader.

> **Shared docs:** the shared docs live in the top-level `docs/` folder. They
> are read-only reference — never edit them from within this package, and the
> docs win on conflict.

## Documentation cross-references

All design docs live in the top-level `docs/` folder (paths relative to the repo root).

| Document                     | Path                          |
| ----------------------------- | ------------------------------ |
| Architecture (package boundaries) | `docs/architecture/README.md` |
| API conventions (cross-cutting) | `docs/api/README.md`        |
| RFCs (once a domain exists)   | `docs/rfcs/README.md`         |
| Shared Standards (index)      | `docs/standards/README.md`    |
| Agent Playbook (shared)       | `docs/standards/agent-playbook.md` |
| Guides                        | `docs/guides/README.md`       |

**ADRs:** `docs/adrs/` holds one record per decision that is expensive to reverse,
numbered in the order it was made; `docs/adrs/README.md` is the index. Read the ones whose
subject you are about to touch before you touch it.
The one most likely to be needed here is ADR-0008, which says **where a port lives** — which
is why `IMailer` and `IPasswordHasher` are in this package and not in core.

## Module structure

Every feature module follows this layout (full version in `apps/backend/STANDARDS.md`):

```
src/<module>/
├── <module>.module.ts
├── <module>.controller.ts
├── <module>.service.ts
├── dto/
├── <entity>.entity.ts
├── __tests__/
└── <module>.repository.ts          # Only if complex queries exist
```

**Present today:** `health/` (liveness and database-backed readiness probes, no business logic); `auth/` (the
`/auth` endpoints including recovery, the global `JwtAuthGuard`, `PlatformAdminGuard`,
`@Public()`/`@CurrentUser()`, the session and rotation services, and the one
`REFRESH_COOKIE` constant); `identities/` (the password identity, the argon2id hasher, the
breached-password port, and `/users/me/identities`); `users/` (`/users/me`, the
platform-admin endpoints, and `GET /users/me/principal`); `mail/` (the `IMailer` port, the
file-writing development adapter, and the message templates); `organizations/`
(`/organizations`, `/organizations/:id/members`, the invitation routes including the
unscoped `POST /invitations/:token/accept`); `authorization/` (`PermissionsGuard`,
`@RequirePermission`, `PrincipalService` — the one hydrator of a `Principal` — and
`/organizations/:id/grants`); `audit/` (`GET /audit` and `GET /organizations/:id/audit`);
`mfa/` (the `/mfa` endpoints, the challenge, verification and recovery-code services, and
the TOTP and WebAuthn ceremonies — the second factor every path that would open a session
asks about); `throttling/` (`ForgeThrottlerGuard`, `@Throttled`, the bucket definitions and
the Postgres-backed counter store); and the persistence record classes, which sit beside the
module that owns them. Those are named `<Thing>Record` because
`__FORGE_SCOPE__/core` already exports `User`, `AuthIdentity`, `Session`, `AuditEntry`,
`Organization`, `Membership`, `Invitation` and `ResourceGrant`, and a repository imports
both in one file.

> **`AuthorizationModule` is imported by `OrganizationsModule`, `AuditModule` and
> `UsersModule`, not by `AppModule`** — for `PermissionsGuard` and, in `UsersModule`'s
> case, for `PrincipalService`. A guard is instantiated in the module context of the
> controller that names it, so **every module hosting a guarded controller must register
> every repository that guard injects**. That is not a type error and not a lint error: it
> is an `UnknownDependenciesException` at start-up, and for one commit the generated
> application did not boot at all while every fast tier stayed green.
> `__tests__/guard-wiring.spec.ts` is what turns red — it *discovers* guards from
> `@UseGuards` metadata rather than reading a list, so a new guard on a new controller is
> covered without anyone remembering to add it.

**Shared utilities:** `src/common/` — filters, interceptors, pipes, types, i18n plumbing.

> Guards live in the **auth module** (`src/auth/guards/`), the idiomatic NestJS placement —
> `src/common/` does **not** hold guards. `JwtAuthGuard` is registered as `APP_GUARD` in
> `app.module.ts`, so **every route is closed unless it carries `@Public()`**. That one
> provider is the application's security posture; deleting it breaks no type, fails no lint
> rule, and opens every endpoint. `auth/__tests__/global-guard.spec.ts` (D6) is what turns
> red.

## What's wired up

- `AppModule` — `ConfigModule` (global, `.env`), `TypeOrmModule.forRootAsync` reading
  `DATABASE_URL`, every persistence record class the application maps, the translation
  module, one module per feature area, and
  `GLOBAL_PROVIDERS` — the `APP_GUARD`, `APP_PIPE`, `APP_FILTER` and `APP_INTERCEPTOR`
  described above. **`app.module.ts`'s own `imports` and `entities` arrays are that list and
  neither is restated here**: a copy of either falls behind the first module or entity added
  after it was written, and both have. The `entities` array in particular is not a free list
  — `__tests__/composition-root.spec.ts` asserts it entity by entity, so a record class
  registered late turns it red, and one registered early costs nothing. Everything that can
  be module metadata IS, because module metadata is assertable without starting anything;
  that same spec reads this list off the decorator and its table says which fault each
  assertion catches.
- `app.setup.ts` — **everything the framework has no declarative form for, and nothing
  else**: whatever can be module metadata is in `app.module.ts` instead, so this file is
  defined by that rule rather than by a list, and the file itself is what to read for its
  current contents. As written: `cookie-parser`, CORS from `CORS_ORIGIN`, and the OpenAPI
  document at `/api/docs`, mounted unless `NODE_ENV` is exactly `production`. That last one
  goes through the HTTP adapter rather than a controller, so the global guard never sees
  those routes — any environment not labelled `production` serves the full API map
  anonymously, which this package's own `README.md` spells out. A spec calls **this
  function**, not a copy.
- `main.ts` — a handful of statements: create, `configureApp`, read `PORT` (default `3000`),
  listen. Deliberately almost empty: it is excluded from coverage and no spec imports it,
  so anything added there is invisible to the whole suite. That was measured.
  There is **no** global route prefix — the health endpoints are polled unprefixed, by
  the container healthcheck (which polls readiness) and by smoke tests; keep it that way
  unless every poller of them is updated at the same time. Both health endpoints carry
  `@Public()`: without it the global guard answers `401`, a `401` is a response, so the
  healthcheck's `r.ok` is false for ever and nothing that waits on `service_healthy`
  starts.
- **Configuration this package refuses to boot without:** `DATABASE_URL`, `JWT_SECRET`
  (the key access credentials are signed with), `PUBLIC_WEBAPP_URL` (the origin every
  mail link is built from — verification, password reset **and** invitation) and
  `PUBLIC_API_URL` (the origin every federated provider redirect URI is built from) and
  `MFA_ISSUER` (the name an authenticator app shows beside the code, in the enrollment
  URI). `OAuthService` is an ordinary provider of `AuthModule`, so `PUBLIC_API_URL` is
  required at construction whether or not any federated provider is actually configured,
  and `MfaService` reads `MFA_ISSUER` at construction likewise. Each of these is a `getOrThrow`
  with no default in the code, deliberately — see `.env.example`.
- `nest-cli.json` carries `"entryFile": "apps/backend/src/main"` **and**
  `"outDir": "dist/apps/backend/src"` on its `assets` entry, and both are load-bearing.
  `tsconfig.json` pins `rootDir` to the workspace root, so `nest build` emits
  `dist/apps/backend/src/main.js`; `nest start` (what `start:dev` and therefore the dev
  container run) otherwise looks for `dist/main` and dies with `MODULE_NOT_FOUND` **after
  reporting a clean compile**, so the container reports "Up", never healthy, and everything
  waiting on `service_healthy` stalls.

  **These places name that layout, and every one of them has to agree:**

  1. `package.json` → `start:prod`
  2. `package.json` → `migration:run:prod`
  3. `nest-cli.json` → `entryFile` (added after the dev container had been unable to boot
     for 60 commits)
  4. `Dockerfile` → the prod `CMD`. It repeats the literal rather than calling `start:prod`
     on purpose: `node` as PID 1 receives `SIGTERM` from `docker stop`, where `npm run`
     would sit in between and not forward it.
  5. `nest-cli.json` → `outDir` on the `assets` entry

  Two of them were missed when `rootDir` was pinned, and both failures were invisible
  to every fast tier. Adding another consumer means adding it to this list.

  Without (5) the `i18n/**/*` files are copied to
  `dist/i18n/`, while `app.module.js` — which resolves them with `join(__dirname, 'i18n')`
  — sits in `dist/apps/backend/src/`. The build succeeds and then **the production image
  does not boot at all**: `nestjs-i18n` throws `I18nError: i18n path (...) cannot be found`
  from `onModuleInit`, after every route has been mapped. Measured by running the compiled
  output directly. **No test in this repository can see it** — jest runs against `src/`,
  where the files already sit beside the module — and neither can the dev container, which
  also runs from `src/`. Building and starting the production target (`npm run prod:build`,
  `npm run prod:up`) is what catches it.
- `src/db/data-source.ts` — the TypeORM CLI data source for `migration:generate` /
  `migration:run`, reading `MIGRATION_DATABASE_URL` and falling back to `DATABASE_URL`.
  **Two roles, on purpose:** migrations run as the schema owner, the application connects
  as a restricted role that owns nothing, and `UPDATE`/`DELETE` on `audit_entries` are
  revoked from that role — which a non-owner cannot grant back to itself. That is the
  whole of the append-only audit guarantee. **Read
  [ADR-0009](../../docs/adrs/0009-two-database-roles.md) before touching this schema**: it
  lists the ways to make the revoke decorative while every test stays green, and the
  one most likely to be reached for by accident is adding a foreign key to `audit_entries`.
- `src/i18n/en/*.json` + `src/common/i18n/` — translation plumbing, **registered** as the
  exported `I18N` dynamic module in `app.module.ts`. It was not, for a time, and the
  consequence was concrete: `HttpExceptionFilter` fell back to emitting the raw key, so a
  refused sign-in answered `{"message":"errors.auth.invalid_credentials"}` rather than the
  English beside it. Specs now assert that a body carries prose rather than a key, so
  the registration cannot silently go away again. See `STANDARDS.md` — nestjs-i18n
  mechanics.

## Pinned dependencies

**The list lives in `package.json` under `//pinned`, and is not copied here.** That is where
`npm outdated` sends a reader, it sits beside the ranges it explains, and a table restated in
this file falls behind the moment a pin is added — which it did. Read it there: it names every
held package, the exact versions each pin was verified against, and what moving off it costs.
It also records one dependency that is deliberately **not** held back, so that stays a choice
rather than an accident.

What you need to know before proposing an upgrade: this package compiles to CommonJS and its
Jest runner is CommonJS, so a dependency that is ESM-only (`"type": "module"`) fails with
`Must use import to load ES Module` before a single test runs — on the Node that CI and both
Docker images use, and on newer ones. A caret range cannot cross a major on its own, so the
usual escape is moving this package's test runner off CommonJS.

**That is the shape of most of these pins but not of all of them**, and the difference matters
to anyone attempting one: a package can be held because the ESM-only module is a *transitive*
dependency rather than itself, in which case there is a second escape that does not touch the
test runner. `//pinned` says which case each pin is and what each one would cost. Read it
there rather than assuming they are alike.

## Common utilities

The **Location** column is where the class is defined. Where a utility is *registered*
is a separate question and the answer is the same for every row below whose *Registered
as* is `APP_*`: those are entries in `GLOBAL_PROVIDERS` in `app.module.ts`, **not** imperative calls in `main.ts`.
That distinction is the whole reason they are assertable — see `app.setup.ts`'s own
comment for what it cost when they lived in `bootstrap()`. `APP_INTERCEPTOR` has more
than one entry; `app.module.ts` is the list.

| Utility                | Defined in                  | Registered as | Purpose                                                  |
| ----------------------- | ---------------------------- | --- | --------------------------------------------------------- |
| `HttpExceptionFilter`   | `src/common/filters/`        | `APP_FILTER` | Global exception filter → standard error shape           |
| `I18nResponseInterceptor` | `src/common/interceptors/` | `APP_INTERCEPTOR` | Translates a `messageKey` success payload into `message`  |
| `PlatformAdminOverrideInterceptor` | `src/auth/guards/` | `APP_INTERCEPTOR` | Writes the `PLATFORM_ADMIN_OVERRIDE` entry `PlatformAdminGuard` marks, **after** the handler — so a read of `/audit` is not inside the page it returns. Does nothing unless that guard marked the request. |
| `I18nValidationPipe`    | `nestjs-i18n`                 | `APP_PIPE` | Localized class-validator integration, with `whitelist` + `forbidNonWhitelisted` |
| `JwtAuthGuard`          | `src/auth/guards/`            | `APP_GUARD` | Closes every route not marked `@Public()` |
| `PlatformAdminGuard`    | `src/auth/guards/`            | per-route `@UseGuards` | Closes a route to all but a platform administrator, and records every pass |
| `PermissionsGuard`      | `src/authorization/`          | per-controller `@UseGuards` + `@RequirePermission` | Hydrates the actor's `Principal` and answers the route's declared permission through core's `can()`. Refuses with a **bare** `NotFoundException` at every site, so "you may not" and "there is no such thing" are byte-identical (D9). Deleting it from a controller is caught by that controller's own authorization cases, never by a type. |
| `ParseUuidParamPipe`    | `src/common/pipes/`           | per-param | Localized UUID param validation                            |
| `PaginationQueryDto`    | `src/common/types/`           | — | `page`/`limit` query DTO + paginated response shape. Endpoints that add filters (`AuditQueryDto`, `ListUsersQueryDto`) declare their own rather than extending it, so every field an endpoint accepts is visible in one place — `forbidNonWhitelisted` makes an undeclared one a 400. |

---

## Agents

The lifecycle, trigger semantics, and "runs automatically after X" rules are
defined once in the shared playbook: **`docs/standards/agent-playbook.md`**.
Per-role behavior lives in the workspace-root `.claude/agents/*.md`
(see `.claude/agents/README.md` for the full roster).

Flow: `planner → core-implementer → [ backend-implementer ‖ webapp-implementer ]
→ [ *-tester ‖ reviewer ] → documenter → closer → pr`, with a fix loop back to the
relevant implementer.
