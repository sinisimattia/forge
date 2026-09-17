# __FORGE_TITLE__

__FORGE_DESCRIPTION__

## Prerequisites

- [Docker](https://www.docker.com/) with Compose v2 (`docker compose`)
- Node.js 22 (only needed on the host for editor tooling — everything actually runs in
  containers)

## Quick start

```bash
cp .env.example .env
npm install
npm run dev:up
```

- Backend API: [http://localhost:3000](http://localhost:3000) (health check at `/health`)
- Webapp: [http://localhost:3001](http://localhost:3001)

Tear the stack down with `npm run dev:down`, or wipe its volumes too with `npm run dev:reset`.

## Packages

| Path           | What it is                                                              | Guidance                                               |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/backend` | NestJS REST API + TypeORM (PostgreSQL)                                  | `apps/backend/CLAUDE.md` → `apps/backend/STANDARDS.md` |
| `apps/webapp`  | Nuxt 4 / Vue 3 frontend                                                 | `apps/webapp/CLAUDE.md` → `apps/webapp/STANDARDS.md`   |
| `libs/core`    | Framework-agnostic domain: entities, `I*Service` contracts, conformance suites | `libs/core/CLAUDE.md` → `libs/core/STANDARDS.md` |

## Common tasks

Run via NX, either per project or across everything that changed:

```bash
npx nx <target> <project>       # e.g. npx nx test apps/backend
npx nx run-many -t <target>     # e.g. npx nx run-many -t lint
npm run affected                # lint, test, build, typecheck — only what changed
```

## Documentation

- `docs/adrs/` — architecture decision records
- `docs/rfcs/` — feature proposals
- `docs/architecture/` — system boundaries
- `docs/standards/` — the authoritative, shared cross-package rules

See `CLAUDE.md` for how the packages and docs fit together, and `forge.json` for this
project's Forge provenance.
