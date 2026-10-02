# __FORGE_TITLE__ Webapp

The **Nuxt 4 / Vue 3** frontend for __FORGE_TITLE__ — Tailwind CSS, i18n, and an Atomic
Design component structure. It talks to the [backend API](../backend/README.md). Part of
the [__FORGE_TITLE__ monorepo](../../README.md). Ships a generic, domain-free component
library — atoms, molecules and one page template, each with a Storybook story — on a
named colour palette that replaces Tailwind's stock one, plus a home page composed from those atoms.

It also ships the client half of the identity foundation end to end: fetchers, the
`I*Service` implementations over the wire, the auth store, `useAuth()`, the `auth` and
`guest` route middleware, the server-side session renewal, and the pages a person actually
uses. The route is the file path under `app/pages/`, so `ls` it for the list.

## Running

The webapp runs as part of the containerized stack — from the **repo root**:

```bash
npm run dev:up         # starts the webapp (+ backend + Postgres)
npm run dev:logs       # follow logs
```

The app is served at **http://localhost:3001**, and calls the API at
`http://localhost:3000` (configurable via `NUXT_PUBLIC_API_BASE`; see `.env.example`).

## Working on it

Build, test, lint, and typecheck run on **Node 22** — inside the container or CI:

```bash
docker compose exec webapp sh       # then, from /app:
npx nx test webapp                  # Vitest unit tests
npx nx typecheck webapp
npx nx lint webapp
npx nx build webapp
```

Storybook runs standalone: `npm run storybook` (from `apps/webapp`) serves the component
explorer on `http://localhost:6006`.

### Structure

Components follow Atomic Design under `app/components/` — all four layers are populated,
`atoms` and `molecules` by the generic library, `organisms` and `templates` by the identity
surface — consumed by `app/pages/` through `app/layouts/`. `npm run layers` is the gate that
holds the direction of those dependencies, and it fails when pointed at nothing rather than
reporting a clean scan.

Data access is layered **fetcher → composable → component** (see `STANDARDS.md`):
`app/fetchers/` is the only place a backend path is spelled, `app/services/` implements the
`__FORGE_SCOPE__/core` `I*Service` contracts over the wire, and a component reaches neither
directly — it calls a composable. Your own domain follows the same three steps once it
exists in `__FORGE_SCOPE__/core`.

## Conventions & docs

- Webapp-specific rules: [STANDARDS.md](STANDARDS.md)
- Shared standards (naming, typing, i18n, testing, git, data): [../../docs/standards/](../../docs/standards/)
- Shared domain core (the `I*Service` contracts this app will implement): [../../libs/core/README.md](../../libs/core/README.md)
- Architecture overview: [../../docs/architecture/README.md](../../docs/architecture/README.md)

Docs win on conflict.
