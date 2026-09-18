# __FORGE_TITLE__ Backend — Agent Playbook

## Project Overview

This package is the **backend**: a NestJS REST API with TypeORM and PostgreSQL. It ships as
a skeleton — no business domain, no auth — with a single `health/` module. Feature domains
(e.g. `articles`, `comments`, `tags`) land here once `libs/core` defines their entities and
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

**Present today:** `health/` (liveness probe, no business logic).

**Shared utilities:** `src/common/` — filters, interceptors, pipes, types, i18n plumbing.

> Guards do not exist yet (no auth in this skeleton). Once auth is added, guards belong
> in an **auth module** (`src/auth/guards/`), the idiomatic NestJS placement —
> `src/common/` does **not** hold guards.

## What's wired up

- `AppModule` — `ConfigModule` (global, `.env`), `TypeOrmModule.forRootAsync` reading
  `DATABASE_URL`, and `HealthModule`.
- `main.ts` — global `I18nValidationPipe`, `I18nResponseInterceptor`, and
  `HttpExceptionFilter`; CORS from `CORS_ORIGIN`; listens on `PORT` (default `3000`).
  There is **no** global route prefix — `GET /health` is polled unprefixed by the
  container healthcheck and by Task 14's e2e smoke test; keep it that way unless every
  consumer of `/health` is updated at the same time.
- `src/db/data-source.ts` — the TypeORM CLI data source for `migration:generate` /
  `migration:run`, reading `DATABASE_URL`.
- `src/i18n/en/*.json` + `src/common/i18n/` — translation plumbing, scaffolded but not
  yet registered as an `I18nModule` (no translated routes exist yet). See
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
