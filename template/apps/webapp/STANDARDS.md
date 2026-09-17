# __FORGE_TITLE__ Webapp — Local Standards (Nuxt / Vue / Atomic Design)

This file holds **only** the framework-specific rules for this Nuxt 4 + Vue 3 webapp.
Framework-agnostic rules (naming, typing, i18n philosophy, testing, git, data conventions)
live in the shared standards and are **not** restated here — link and read those.

## Authoritative standards

Read these before writing or judging code. **If this file and a shared/ADR document
disagree, the document wins, not this file.**

| Topic                                                      | Authoritative source                  |
| ------------------------------------------------------------ | --------------------------------------- |
| Descriptive names, forbidden-abbreviation list              | `docs/standards/naming.md`             |
| No `any`, minimal `never`, named types in dedicated files    | `docs/standards/typing.md`             |
| No hard-coded user-facing text; English-only philosophy      | `docs/standards/i18n.md`               |
| Testing philosophy (unit + e2e expectations)                 | `docs/standards/testing.md`            |
| Commit / branch conventions                                  | `docs/standards/git.md`                |
| Money as integer cents, dates in UTC, enums from source      | `docs/standards/data-conventions.md`   |
| Agent roster + lifecycle                                     | `docs/standards/agent-playbook.md`     |
| Domain entities, `I*Service` contracts (once a domain exists) | `libs/core/README.md`                  |

The shared docs live in the top-level `docs/` folder and are read-only reference; never
edit them from within this package.

---

## Vue SFC conventions

- Use `<script setup lang="ts">` in **all** `.vue` files.
- Rely on **Nuxt auto-imports** — never manually import `ref`, `computed`, `useState`,
  `useFetch`, `useAsyncData`, `useRoute`, `useRouter`, `definePageMeta`, `navigateTo`,
  `useI18n`, etc. A PascalCase component tag in a `<template>` is auto-imported too — no
  `import` statement needed. (Story files are the one exception: Storybook does not run
  through Nuxt's auto-import compiler, so a `.stories.ts` file imports its component
  explicitly, as `AppButton.stories.ts` does.)
- **Testing components under Vitest:** Nuxt's auto-imports do not exist under plain
  Vitest either — a component that calls `computed()`/`ref()`/`useI18n()` without an
  import statement throws a `ReferenceError` when mounted with `@vue/test-utils` unless
  those globals are stubbed first. Call `stubNuxtAutoImports()` (from
  `~/test/stubNuxtAutoImports`) in a `beforeEach`, paired with `vi.unstubAllGlobals()` in
  `afterEach` — see `app/test/AppButton.spec.ts` for the reference pattern.

## Types

- Any `interface` / `type` that is **`export`ed** from a `.vue`, composable, store,
  fetcher, or page file, **or** that is imported by more than one module, belongs in
  `app/types/*.ts` (one file per domain) and is re-exported from `app/types/index.ts`.
  Consumers `import type { … } from '~/types'`. **Never `export` a type from outside
  `app/types/`** — needing to export it is the signal it belongs there. (`app/types/`
  does not exist yet in this skeleton; create it when the first exported type appears.)
- **Single-file-local, non-exported types stay co-located** with the one file that uses
  them — component `Props` interfaces (as in `AppButton.vue`) and `defineEmits<…>()`
  signatures, small presentational union aliases, and page/component-local view-models.
- Use enums from `app/types/` — never inline string literals for status / type / mode
  values, once such values exist. Entity/enum shapes are authoritative in `libs/core`
  (and `docs/rfcs/*.md` once a domain RFC exists) — never redefine them locally.
- (No-`any`, named-type, naming discipline → `typing.md` / `naming.md`.)

## Atomic Design hierarchy

Strict layering: **atoms → molecules → organisms → templates → pages**. Never invent new
structural layers.

| Layer    | Path                          | May import                                                                 | May contain raw HTML? | May contain raw CSS? |
| -------- | ----------------------------- | -------------------------------------------------------------------------- | --------------------- | -------------------- |
| Atom     | `app/components/atoms/**`     | nothing (HTML + utils/types only)                                          | yes — any HTML        | yes (last resort)    |
| Molecule | `app/components/molecules/**` | atoms only                                                                 | no UI primitives      | no                   |
| Organism | `app/components/organisms/**` | atoms + molecules                                                          | no UI primitives      | no                   |
| Template | `app/components/templates/**` | atoms + molecules + organisms (via slots; no data fetching/business logic) | no UI primitives      | no                   |
| Page     | `app/pages/**`                | any component + composables                                                | no UI primitives      | no                   |

"Can this be reused in a completely different context?" If yes, it is likely an atom or
molecule; if it is tied to a domain concept, it is an organism. Only `atoms/` is populated
today (`AppButton.vue`); the other levels are created as soon as a second component needs
them.

- **HTML-only-in-atoms:** raw HTML UI primitive tags (`button`, `input`, `textarea`,
  `select`, `option`, `a`, `img`, `h1`–`h6`, `p`, `span`, `label`, `form`, `svg`, etc.)
  appear **exclusively inside atoms**. Molecules, organisms, templates, pages, and layouts
  compose UI from atom components only. A bare `div`/`section` is allowed outside an atom
  **only** when no atom fits: it holds a template `ref`/`id` consumed as a DOM element, it
  is an SFC/app root where wrapping adds nothing (as in `app.vue`), or it is a pure
  positioning/`relative`/`absolute`/`overflow` shim — add a short comment explaining why.
- **CSS-only-in-atoms:** raw CSS — `<style>`/`<style scoped>` blocks and inline
  `style=""` / `:style` bindings — appears **exclusively inside atoms**. Everywhere else,
  style only through Tailwind utility classes and atom props — never raw CSS. Global
  stylesheets under `app/assets/css/` (the Tailwind entry) are infrastructure, not
  component CSS, and are exempt.

## Storybook

- Every component under `app/components/**` gets a co-located story under
  `stories/<same-layer>/<Component>.stories.ts` (e.g. `app/components/atoms/AppButton.vue`
  → `stories/atoms/AppButton.stories.ts`) — `AppButton` is the reference example.
  A component with no story is treated as unreviewed / unfinished.
- Import the `Meta`/`StoryObj` types from `@storybook-vue/nuxt` (not `@nuxtjs/storybook`),
  import the component via the `~/components/...` alias (not a relative path), close the
  meta object with `satisfies Meta<typeof Component>`, and derive `Story` as
  `StoryObj<typeof meta>`. Tag every story `['autodocs']`.
- Each meaningfully distinct visual/behavioral state gets its own named export
  (`Primary`, `Secondary`, `Disabled`, …), not a single story with a control the reader
  has to discover.

## Layering: Fetcher → Composable → Component

Once a domain exists, external calls (HTTP requests, third-party SDKs) live in
`app/fetchers/[domain].fetcher.ts`. Composables import fetcher functions and manage
reactive state (loading/error/data). Components and pages call composables only — **never
fetchers or API clients directly.**

```
app/fetchers/[domain].fetcher.ts   ← useApi() / $fetch / external SDKs
        ↓
app/composables/use[Domain].ts     ← imports fetchers, manages state
        ↓
app/components/**/*.vue · app/pages/**/*.vue   ← call composables only
```

- Use `useFetch`/`useAsyncData` for SSR-compatible fetching; `$fetch` for client-only
  calls. Both belong in fetchers, not components.
- The backend base URL comes from runtime config (`runtimeConfig.public.apiBase`,
  `runtimeConfig.apiBaseServer` for SSR-inside-Docker — see `nuxt.config.ts`).
- None of `app/fetchers/`, `app/composables/`, or `app/stores/` exist yet in this
  skeleton — this section documents the standing rule for when Phase 2 adds them.

## Tailwind

- Always use Tailwind utility classes (subject to the CSS-in-atoms rule above). This
  skeleton uses Tailwind's default palette and spacing scale — no custom design-token
  override exists yet.
- Avoid arbitrary values (`w-[347px]`, `text-[#ff0000]`). If a value is genuinely needed
  and reused, add it to `tailwind.config.ts` instead: a project-specific color palette
  goes in `theme.colors`; everything else (spacing, radius, fonts, …) goes in
  `theme.extend` so Tailwind defaults are not overridden. If this project later adopts a
  closed custom-token palette (replacing the defaults entirely), update this section to
  say so and list the tokens.

## i18n mechanics (`@nuxtjs/i18n`)

The _philosophy_ (no hard-coded user-facing text; English is the official, default, and
only locale) is in `docs/standards/i18n.md`. The Nuxt-specific mechanics:

- In `.vue` files use the auto-imported `const { t } = useI18n()` and
  `t('section.key')`. In composables obtain `t` the same way for user-facing message
  strings. Do not translate console logs, internal/developer errors, API paths, enum
  values, or CSS classes.
- `defineProps` defaults must be compile-time constants — you cannot call `t()` in a prop
  default. Use a computed fallback:
  `const label = computed(() => props.label ?? t('common.actions.confirm'))`.
- Translation file: `app/locales/en.json` — one flat file today. If the vocabulary grows
  large enough to need splitting by domain, follow `@nuxtjs/i18n`'s multi-file locale
  config and update this section.
- **Escape vue-i18n special characters** in values: a literal `@` must be written
  `{'@'}` (e.g. `"you{'@'}example.com"`); escape literal braces as `{'{'}` / `{'}'}`;
  avoid a raw `|`.
- Keys are camelCase, max 3 levels deep. Reuse `common.*` keys before adding new ones.
  Interpolation is named only: `t('common.pagination.showing', { from, to, total })`.

## SEO / page metadata

- Every page under `app/pages/**` that is intended to render server-side (the default in
  Nuxt) sets its title and any relevant meta via `useHead` or `useSeoMeta` — never leave
  the default/empty `<title>`. `index.vue` is the reference example
  (`useHead({ title: t('home.title') })`).
- A page opted out of SSR (`definePageMeta({ ssr: false })`, once such pages exist — e.g.
  an authenticated dashboard) is exempt: it is not indexable and does not need SEO meta.

## Accessibility

- Interactive behavior belongs on an actual interactive element — a `button`/`a` atom (or
  a native `input`/`select`) — never a `@click` handler on a `div`/`span`. If a click
  target must be a non-interactive element for layout reasons, it still needs
  `role`, `tabindex="0"`, and a keyboard (`@keydown.enter`/`@keydown.space`) handler; the
  simpler fix is almost always to use a button atom instead.
- Every control has an accessible name: visible text (as `AppButton`'s `<slot />`
  provides), or an explicit, translated `aria-label` when there is no visible label (e.g.
  an icon-only button).
- Respect the Tailwind `touch` size tokens (`min-h-touch`, `min-w-touch`) for tap targets
  per WCAG 2.5.5 where a control's default size would be smaller.

---

## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| W1 | Component sits at the right atomic level | a `.vue` under `components/` whose imports contradict its level | blocking | STANDARDS.md — Atomic design |
| W2 | Components never call fetchers directly | `grep -rn "fetcher" app/components/` | blocking | STANDARDS.md — fetcher → composable → component |
| W3 | Tailwind tokens only, no arbitrary values | `grep -rnE "\[[0-9]+px\]" app/` | warning | STANDARDS.md — Tailwind tokens |
| W4 | No `any` or `never` escapes | `grep -rnE ": (any\|never)\b" app/` | blocking | `docs/standards/typing.md` |
| W5 | Every component has a story | a `.vue` under `components/` with no matching `stories/**/*.stories.ts` | warning | STANDARDS.md — Storybook |
| W6 | UI strings are translated, never inline | `grep -rnE ">[A-Z][a-z]+ " app/**/*.vue` | blocking | `docs/standards/i18n.md` |
| W7 | SSR pages set title and meta | a changed `pages/**/*.vue` with no `useHead`/`useSeoMeta` | warning | STANDARDS.md — SEO |
| W8 | Interactive elements are reachable and labelled | `grep -rn "@click" app/**/*.vue` on a non-button element | blocking | STANDARDS.md — Accessibility |
