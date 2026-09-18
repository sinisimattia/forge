# __FORGE_TITLE__ Backend — Agent Playbook

## Project Overview

This package is the **backend**: a NestJS REST API with TypeORM and PostgreSQL. It ships as
a skeleton with no business domain of its own. What it does ship is the identity
foundation: registration, sign-in, the session lifecycle, and a global guard that closes
every route not marked `@Public()`. Feature domains (e.g. `articles`, `comments`, `tags`)
land here once `libs/core` defines their entities and `I*Service` contracts (see
`libs/core/CLAUDE.md`).

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

**ADRs:** `docs/adrs/` — conventions: 0001 (single-source docs), 0002 (consolidated agent
roster), 0003 (architecture docs describe boundaries), 0004 (API reference lives with
implementation). Platform: 0005 (identity is separate from user), 0006 (authorization is a
pure function in core), 0007 (tenancy is explicit, never ambient), 0008 (ports, not vendors).

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

**Present today:** `health/` (liveness probe, no business logic); `auth/` (the
`/auth` endpoints, the global `JwtAuthGuard`, `@Public()`/`@CurrentUser()`, the session
and rotation services, and the one `REFRESH_COOKIE` constant); `identities/` (the password
identity, the argon2id hasher, the breached-password port); `audit/`; and the persistence
record classes under `users/`, `identities/`, `auth/entities/` and `audit/`. Those are
named `<Thing>Record` because `__FORGE_SCOPE__/core` already exports `User`,
`AuthIdentity`, `Session` and `AuditEntry`, and a repository imports both in one file.

**Shared utilities:** `src/common/` — filters, interceptors, pipes, types, i18n plumbing.

> Guards live in the **auth module** (`src/auth/guards/`), the idiomatic NestJS placement —
> `src/common/` does **not** hold guards. `JwtAuthGuard` is registered as `APP_GUARD` in
> `app.module.ts`, so **every route is closed unless it carries `@Public()`**. That one
> provider is the application's security posture; deleting it breaks no type, fails no lint
> rule, and opens every endpoint. `auth/__tests__/global-guard.spec.ts` (D6) is what turns
> red.

## What's wired up

- `AppModule` — `ConfigModule` (global, `.env`), `TypeOrmModule.forRootAsync` reading
  `DATABASE_URL`, the seven persistence record classes, `HealthModule`, `MailModule`,
  `AuditModule`, `AuthModule`, and the `APP_GUARD` provider described above.
- `main.ts` — global `I18nValidationPipe`, `I18nResponseInterceptor`,
  `HttpExceptionFilter` and `cookie-parser`; CORS from `CORS_ORIGIN`; listens on `PORT`
  (default `3000`).
  There is **no** global route prefix — `GET /health` is polled unprefixed by the
  container healthcheck and by the e2e smoke test; keep it that way unless every
  consumer of `/health` is updated at the same time. `GET /health` also carries
  `@Public()`, without which the global guard answers it `401` and nothing that waits on
  `service_healthy` ever starts.
- **Configuration this package refuses to boot without:** `DATABASE_URL`, `JWT_SECRET`
  (the key access credentials are signed with) and `PUBLIC_WEBAPP_URL` (the origin every
  mail link is built from). All three are `getOrThrow` with no default, deliberately —
  see `.env.example`.
- `src/db/data-source.ts` — the TypeORM CLI data source for `migration:generate` /
  `migration:run`, reading `MIGRATION_DATABASE_URL` and falling back to `DATABASE_URL`.
  **Two roles, on purpose:** migrations run as the schema owner, the application connects
  as a restricted role that owns nothing, and `UPDATE`/`DELETE` on `audit_entries` are
  revoked from that role — which a non-owner cannot grant back to itself. That is the
  whole of the append-only audit guarantee; see `src/db/migrations/` and `.env.example`.
- `src/i18n/en/*.json` + `src/common/i18n/` — translation plumbing, **still not registered
  as an `I18nModule`**, and now with routes that depend on it. The consequence is concrete:
  `HttpExceptionFilter` falls back to emitting the raw key, so a refused sign-in answers
  `{"error":"Unauthorized","message":"errors.auth.invalid_credentials"}` rather than the
  English in `src/i18n/en/errors.json`. Statuses and shapes are correct; the prose is a key.
  Registering the module is a cross-cutting change to every response and is not yet done. See
  `STANDARDS.md` — nestjs-i18n mechanics.

## Common utilities

| Utility                | Location                    | Purpose                                                  |
| ----------------------- | ---------------------------- | --------------------------------------------------------- |
| `HttpExceptionFilter`   | `src/common/filters/`        | Global exception filter → standard error shape           |
| `I18nResponseInterceptor` | `src/common/interceptors/` | Translates a `messageKey` success payload into `message`  |
| `I18nValidationPipe`    | Global (`main.ts`)            | Localized class-validator integration                     |
| `ParseUuidParamPipe`    | `src/common/pipes/`           | Localized UUID param validation                            |
| `PaginationQueryDto`    | `src/common/types/`           | Shared `page`/`limit` query DTO + paginated response shape |

---

## Agents

The lifecycle, trigger semantics, and "runs automatically after X" rules are
defined once in the shared playbook: **`docs/standards/agent-playbook.md`**.
Per-role behavior lives in the workspace-root `.claude/agents/*.md`
(see `.claude/agents/README.md` for the full roster).

Flow: `planner → core-implementer → [ backend-implementer ‖ webapp-implementer ]
→ [ *-tester ‖ reviewer ] → documenter → closer → pr`, with a fix loop back to the
relevant implementer.
