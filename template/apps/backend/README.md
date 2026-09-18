# __FORGE_TITLE__ Backend

The **NestJS** REST API for __FORGE_TITLE__ — TypeORM over PostgreSQL, i18n error/response
handling. Part of the [__FORGE_TITLE__ monorepo](../../README.md). Ships with no business
domain of its own, and with the identity foundation already built: `GET /health`, the
`/auth` endpoints (registration, verification, sign-in, renewal, sign-out, sessions), and a
global guard that closes every route that does not carry `@Public()`.

## Running

The backend runs as part of the containerized stack — from the **repo root**:

```bash
npm run dev:up         # starts Postgres + backend (+ webapp); migrations run automatically
npm run dev:logs       # follow logs
npm run dev:migrate    # run TypeORM migrations against the running backend
```

The API is served at **http://localhost:3000** (e.g. `GET /health`). It expects a Postgres
reachable via `DATABASE_URL`; in the dev stack that's wired for you. See the root
[README](../../README.md) for the full environment and `.env.example` for configuration.

## Working on it

Build, test, lint, and typecheck run on **Node 22** — inside the container or CI:

```bash
docker compose exec backend sh      # then, from /app:
npx nx test backend                 # Jest unit tests
npx nx typecheck backend
npx nx lint backend
npx nx build backend
```

### Structure

Standard NestJS feature modules under `src/<domain>/` (module, controller, service, TypeORM
entities, DTOs) — none exist yet beyond `src/health/`. Shared concerns live in `src/common/`
(exception filter, response interceptor, pipes, i18n plumbing). Migrations are in
`src/db/migrations/` — generate with `npm run migration:generate`, run with
`npm run migration:run`.

Once a domain exists in `__FORGE_SCOPE__/core`, each backend service implements that
domain's `I*Service` contract (returning framework-agnostic domain entities) and is driven
against the shared conformance suite — see `__FORGE_SCOPE__/core`'s README.

## Conventions & docs

- Backend-specific rules: [STANDARDS.md](STANDARDS.md)
- Shared standards (naming, typing, i18n, testing, git, data): [../../docs/standards/](../../docs/standards/)
- Shared domain core (the `I*Service` contracts this app implements): [../../libs/core/README.md](../../libs/core/README.md)
- API reference: [../../docs/api/README.md](../../docs/api/README.md)

Docs win on conflict.
