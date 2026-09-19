# __FORGE_TITLE__ Webapp

The **Nuxt 4 / Vue 3** frontend for __FORGE_TITLE__ — Tailwind CSS, i18n, and an Atomic
Design component structure. It talks to the [backend API](../backend/README.md). Part of
the [__FORGE_TITLE__ monorepo](../../README.md). Ships a generic, domain-free component
library — 32 atoms, 3 molecules and one page template, each with a Storybook story — on a
named colour palette that replaces Tailwind's stock one, plus a placeholder index page.

It also ships the client half of the identity foundation: fetchers, the three `I*Service`
implementations over the wire, and — from the auth store down — `useAuth()`, the `auth` and
`guest` route middleware, and the server-side session renewal. There are no sign-in or
registration **pages** yet.

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

Components follow Atomic Design under `app/components/` (`atoms` today; `molecules` →
`organisms` → `templates` join once a second component needs them), consumed by
`app/pages/`. Once a domain exists in `__FORGE_SCOPE__/core`, data access is layered
**fetcher → composable → component** (see `STANDARDS.md`) and `app/services/<domain>.service.ts`
provides an HTTP service that implements the `__FORGE_SCOPE__/core` `I*Service` contract —
none of that exists yet.

## Conventions & docs

- Webapp-specific rules: [STANDARDS.md](STANDARDS.md)
- Shared standards (naming, typing, i18n, testing, git, data): [../../docs/standards/](../../docs/standards/)
- Shared domain core (the `I*Service` contracts this app will implement): [../../libs/core/README.md](../../libs/core/README.md)
- Architecture overview: [../../docs/architecture/README.md](../../docs/architecture/README.md)

Docs win on conflict.
