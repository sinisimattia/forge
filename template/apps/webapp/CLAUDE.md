# __FORGE_TITLE__ Webapp — Agent Playbook

## Project Overview

This package is the **webapp**: a Nuxt 4 / Vue 3 frontend. It ships as a skeleton — one
atom (`AppButton`), an index page, and Storybook wired up — no auth, no fetchers/composables/
stores, no business domain. Feature domains (e.g. `articles`, `comments`, `tags`) land here
once `libs/core` defines their entities and `I*Service` contracts (see `libs/core/CLAUDE.md`);
that phase also introduces `app/fetchers/`, `app/composables/`, `app/stores/`, and
`app/services/` (the `I*Service` implementations), none of which exist yet.

- **Framework:** Nuxt 4 (Vue 3 + Composition API)
- **Styling:** Tailwind CSS
- **i18n:** `@nuxtjs/i18n`
- **Component explorer:** Storybook (`@storybook-vue/nuxt`)
- **Package manager:** npm (workspaces)

## Where the rules live

Behavioral standards are **not** restated in this file. They live in two tiers:

- **`apps/webapp/STANDARDS.md`** — webapp-local rules (Atomic Design layering, Tailwind
  tokens, fetcher → composable → component layering, i18n mechanics, Storybook, SEO,
  accessibility).
- **`docs/standards/`** — shared, framework-agnostic rules (`naming`, `typing`, `i18n`,
  `testing`, `git`, `data-conventions`, `agent-playbook`). The shared docs live in the
  top-level `docs/` folder and are read-only reference — never edit them from within this
  package.
- ADRs / RFCs in `docs/` remain authoritative for their topics once they exist.

If a quick-reference below and a standards doc (or an ADR/RFC) disagree, the canonical doc
wins — the tables here only orient a reader.

## Documentation cross-references

All design docs live in the top-level `docs/` folder (paths relative to the repo root).

| Document                          | Path                           |
| ---------------------------------- | ------------------------------- |
| Architecture (package boundaries)  | `docs/architecture/README.md`  |
| API conventions (cross-cutting)    | `docs/api/README.md`           |
| RFCs (once a domain exists)        | `docs/rfcs/README.md`          |
| Shared Standards (index)           | `docs/standards/README.md`     |
| Agent Playbook (shared)            | `docs/standards/agent-playbook.md` |
| Guides                             | `docs/guides/README.md`        |

**ADRs:** `docs/adrs/` — 0001 (single-source docs), 0002 (consolidated agent roster),
0003 (architecture docs describe boundaries), 0004 (API reference lives with implementation).

## Directory structure

```
webapp/
├── nuxt.config.ts             # Nuxt configuration
├── app/
│   ├── app.vue                 # Root component
│   ├── pages/
│   │   └── index.vue           # Placeholder landing page
│   ├── components/
│   │   └── atoms/
│   │       └── AppButton.vue   # The one shipped atom
│   ├── locales/
│   │   └── en.json             # i18n strings (single file today)
│   ├── assets/css/main.css     # Tailwind entry
│   └── test/
│       └── AppButton.spec.ts   # Vitest unit test
├── stories/
│   └── atoms/
│       └── AppButton.stories.ts
└── .storybook/                 # Storybook config
```

Not present yet (Phase 2): `app/components/{molecules,organisms,templates}/`,
`app/fetchers/`, `app/composables/`, `app/stores/`, `app/services/`, `app/middleware/`,
`app/layouts/`, `app/types/`, auth pages.

## What's wired up

- `nuxt.config.ts` — `devServer.port = 3001`; `runtimeConfig.public.apiBase` (from
  `NUXT_PUBLIC_API_BASE`) and `runtimeConfig.apiBaseServer` (from `NUXT_API_BASE_SERVER`,
  used by SSR inside the Docker network); `@nuxtjs/tailwindcss`, `@nuxt/eslint`,
  `@nuxtjs/i18n` modules; components auto-import from `~/components/atoms` without a path
  prefix; `typescript.tsConfig.compilerOptions` re-states `noUnusedLocals`/
  `noUnusedParameters`/`noImplicitReturns`. **This package's TypeScript strictness comes
  from `nuxt.config.ts`, not from `../../tsconfig.base.json`** — Nuxt generates its own
  `.nuxt/tsconfig.*.json` and never extends the monorepo base config (see
  `apps/webapp/tsconfig.json`'s own comment). If you tighten `tsconfig.base.json`, this
  package will not pick it up automatically — update `nuxt.config.ts`'s `typescript` block
  to match.
- `app/app.vue` — `<NuxtLayout><NuxtPage /></NuxtLayout>`, nothing else.
- `app/pages/index.vue` — renders the translated home title/subtitle via `useI18n` and
  sets the page title via `useHead`.
- Storybook — one story (`Atoms/AppButton`) with three variants (`Primary`, `Secondary`,
  `Disabled`); `storybook dev -p 6006` / `storybook build`.

---

## Agents

The lifecycle, trigger semantics, and "runs automatically after X" rules are defined once
in the shared playbook: **`docs/standards/agent-playbook.md`**. Per-role behavior lives in
the workspace-root `.claude/agents/*.md` (see `.claude/agents/README.md` for the full
roster).

Flow: `planner → core-implementer → [ backend-implementer ‖ webapp-implementer ]
→ [ *-tester ‖ reviewer ] → documenter → closer → pr`, with a fix loop back to the
relevant implementer.
