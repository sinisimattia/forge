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
  `app/types/`** — needing to export it is the signal it belongs there. `app/types/ui.ts`
  is the reference example: it holds the component library's own closed unions (`IconName`),
  re-exported from `app/types/index.ts`.
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
molecule; if it is tied to a domain concept, it is an organism. `atoms/`, `molecules/` and
`templates/` ship populated with the generic component library. `organisms/` ships populated
too, but only with the identity surface (`LoginForm`, `RegisterForm`, `AppHeader`,
`SessionList`, `IdentityList`) — which is what an organism looks like: tied to a domain, and
the domain it is tied to is the only one this template has. Yours go beside them.

The commonest mistake here is a domain component put in `atoms/` because it is small. Size
is not the criterion, reusability is. W1 enforces the direction of dependencies, not the
placement — placement is a judgement, and this is the question to ask.

- **HTML-only-in-atoms:** raw HTML UI primitive tags (`button`, `input`, `textarea`,
  `select`, `option`, `a`, `img`, `h1`–`h6`, `p`, `span`, `label`, `form`, `svg`, etc.)
  appear **exclusively inside atoms**. Molecules, organisms, templates, pages, and layouts
  compose UI from atom components only. A bare `div`/`section` is allowed outside an atom
  **only** when no atom fits: it holds a template `ref`/`id` consumed as a DOM element, it
  is an SFC/app root where wrapping adds nothing (as in `app.vue`), or it is a pure
  positioning/`relative`/`absolute`/`overflow` shim — add a short comment explaining why.
- **Exception — the generated placeholder page.** `app/pages/index.vue` ships raw
  `h1`/`p` and is exempt from this rule. It exists to prove the app renders and is meant
  to be deleted when you build your first real page. Do not treat it as the pattern to
  copy; every page you write composes from atoms.
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

## Layering: Fetcher → Service → Composable → Component

External calls (HTTP requests, third-party SDKs) live in `app/fetchers/[domain].fetchers.ts`
and are the only place a path is spelled. A **service** in `app/services/` turns what comes
back into the entities `libs/core`'s contracts promise and what fails into the errors they
name; it is an `I*Service` implementation and is held to core's shared conformance suite.
Composables import services and manage reactive state (loading/error/data). Components and
pages call composables only — **never services, fetchers or API clients directly.**

```
app/fetchers/[domain].fetchers.ts  ← the transport; the only place a path is written
        ↓
app/services/[domain].service.ts   ← implements a core I*Service over the wire
        ↓
app/composables/use[Domain].ts     ← imports services, manages state
        ↓
app/components/**/*.vue · app/pages/**/*.vue   ← call composables only
```

- The transport is an `ApiClient` (`app/types/api.ts`) built by `createApiClient`. It is
  injected rather than imported, which is what lets the conformance suites drive the real
  services against `app/services/__tests__/stubBackend.ts`.
- The backend base URL comes from runtime config (`runtimeConfig.public.apiBase`,
  `runtimeConfig.apiBaseServer` for SSR-inside-Docker — see `nuxt.config.ts`).
- All four layers exist. `app/stores/auth.ts` is the first store: state that outlives a
  component — who is signed in — belongs there, and a composable over it (`useAuth`) is what
  a component calls. A composable that holds its own `ref` for something two components must
  agree about is the mistake this ordering exists to prevent.
- The access credential lives **in memory only** (DEC-3): not in `localStorage`, not in a
  cookie this code writes. `app/stores/__tests__/auth.spec.ts` asserts it by watching the
  write API of all three, not by reading a key back.
- A `?redirect=` taken from a URL goes through `localRedirect` (`app/utils/redirect.ts`)
  before anything navigates to it. An unjudged one is an open redirect, and a sign-in page
  is the highest-value place in an application to have one.

## Tailwind

- Always use Tailwind utility classes (subject to the CSS-in-atoms rule above).
- **The colour palette is closed and replaces Tailwind's.** `theme.colors` in
  `tailwind.config.ts` is an override, not an extension, so the stock scales do not exist
  here: `bg-slate-900`, `text-gray-500` and `border-zinc-200` are not errors, they simply
  **emit nothing** and the element renders unstyled. If something looks unpainted, check its
  class is spelled in this vocabulary first.

  | Token | Scale | Use |
  |---|---|---|
  | `surface` / `backdrop` | single value | page and card surfaces; modal backdrops |
  | `primary` | 50–900 (+`DEFAULT`) | brand actions, focus rings, active states |
  | `neutral` | 50–900 | text, borders, dividers, disabled states |
  | `error` / `success` / `warning` / `info` | partial scales (+`DEFAULT`) | status only |

  The status scales are deliberately partial — `error` has no 400/800, `success` no
  400/500/800/900, and so on. A shade that is not defined emits nothing, exactly like a
  stock colour. Add the shade to the config rather than reaching for a neighbouring scale.
  Re-point these hex values and the whole library follows; that indirection is the reason
  the palette is named rather than literal.
- **Spacing, radius and fonts keep Tailwind's defaults** and are extended, not replaced —
  `theme.extend` holds only `minHeight.touch`/`minWidth.touch` (WCAG 2.5.5) and
  `minHeight.screen-offset` (`AuthTemplate`'s centering region).
- `safelist` is empty, and that is a measured decision, not an oversight — see the comment
  in `tailwind.config.ts`. A class assembled from a lookup keyed by a prop is still a
  literal in a scanned file, so Tailwind finds it. You need a safelist entry only for a name
  built by concatenation (`` `text-${tone}-600` ``) or named in a file outside `content`.
- Avoid arbitrary values (`w-[347px]`, `text-[#ff0000]`). If a value is genuinely needed
  and reused, add it to `tailwind.config.ts` instead: a colour goes in `theme.colors`
  alongside the scales above; everything else (spacing, radius, fonts, …) goes in
  `theme.extend` so Tailwind's defaults for those are not overridden.
- SCSS variables and mixins (`app/assets/scss/_variables.scss`, `_mixins.scss`) are injected
  into every `<style lang="scss">` block by `nuxt.config.ts`, so `$font-family-logo` and
  `@include truncate` work with no import. They are for the few things Tailwind does not
  express; utilities remain the default.

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
  target must be a non-interactive element for layout reasons, it still needs an accessible
  role, `tabindex="0"`, and a keyboard (`@keydown.enter`/`@keydown.space`) handler; the
  simpler fix is almost always to use a button atom instead.
- **Never override a structural role.** `role="button"` on a `tr`, `td`, `th`, `li`, `dt` or
  `dd` does not add a role, it *replaces* the implicit one — the element leaves its table,
  list or definition list as far as assistive technology is concerned, and row/column
  navigation breaks for the whole structure, not just that element. A clickable table row
  therefore takes `tabindex="0"` and keyboard handlers and **keeps** its implicit `row` role;
  `AppTableRow` is the reference example. When a real control is genuinely needed, nest a
  `button`/`a` inside the cell, or adopt the `grid` pattern for the whole table. The same
  applies to a clickable `li`: nest the control, never re-role the item.
- Every control has an accessible name: visible text (as `AppButton`'s `<slot />`
  provides), or an explicit, translated `aria-label` when there is no visible label (e.g.
  an icon-only button).
- Respect the Tailwind `touch` size tokens (`min-h-touch`, `min-w-touch`) for tap targets
  per WCAG 2.5.5 where a control's default size would be smaller.

---

## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| W1 | Component sits at the right atomic level | `npm run layers -w apps/webapp` (`apps/webapp/scripts/check-atomic-layers.mjs`) — resolves every PascalCase tag each file renders to the layer that defines it, and fails on a same-level or upward dependency. Covers `app/components/**`, `app/layouts/**` and `app/pages/**`, and separately refuses any import from `~/pages/` or `~/layouts/`. Runs in CI via `nx affected -t … layers`. **Do not replace this with a grep for `~/components/...` import paths** — see the note below | blocking | STANDARDS.md — Atomic design |
| W2 | Components never call fetchers directly | `grep -rnE -e '\$fetch\(' -e 'useFetch\(' -e 'useAsyncData\(' -e 'fetchers/' app/components/` | blocking | STANDARDS.md — fetcher → composable → component |
| W3 | Tailwind tokens only, no arbitrary values | `grep -rnE '\b[a-z][a-z0-9-]*-\[[^]]+\]' app/` | warning | STANDARDS.md — Tailwind tokens |
| W4 | No `any` or `never` escapes | `grep -rnE -e '\bas[[:space:]]+any\b' -e '\bas[[:space:]]+never\b' -e ':[[:space:]]*any\b' -e ':[[:space:]]*never\b' -e '<any>' app/` | blocking | `docs/standards/typing.md` |
| W5 | Every component has a story | a `.vue` under `components/` with no matching `stories/**/*.stories.ts` | warning | STANDARDS.md — Storybook |
| W6 | UI strings are translated, never inline. **Signal is two patterns, both broad heuristics — read every hit and judge it; do not treat a match as a violation automatically.** They intentionally over-surface (over-surfacing beats missing a real one); both correctly skip `{{ }}` i18n interpolations since `{`/`}` fall outside the scanned run. Run **both**: the first catches `<Tag>prose</Tag>` on one line, the second catches prose on a line of its own between multi-line tags — which is exactly what fixing a `@stylistic/max-len` warning produces, and what the first one misses | `grep -rnE '>[^<>{}]*[A-Za-z]+[^<>{}]*<' app/ --include='*.vue'` then `grep -rnE "^[[:space:]]*[A-Za-z][A-Za-z ,.!?'-]*[A-Za-z.!?][[:space:]]*$" app/ --include='*.vue'` | blocking | `docs/standards/i18n.md` |
| W7 | SSR pages set title and meta | `grep -rL -e "useHead" -e "useSeoMeta" app/pages/ --include='*.vue'` (lists changed pages with neither call) | warning | STANDARDS.md — SEO |
| W8 | Interactive elements are reachable and labelled | `grep -rn "@click" app/ --include='*.vue'` then check the matched tag is not `button`/`a` (a `<button>`/`<a>` hit is not a violation) | blocking | STANDARDS.md — Accessibility |

**W6's second pattern has a known-benign baseline.** On a clean tree it returns ten hits, and
all ten are the same three shapes: an HTML comment's continuation line, a class-array or
expression continuation inside a `:class` binding, and a valueless boolean attribute
(`check-policy`). None is user-facing prose. A hit that is *not* one of those three is worth
reading. The first pattern's baseline is zero.

The final character class is `[A-Za-z.!?]` and not `[A-Za-z]`, which is not a detail: most
user-facing prose ends in a full stop, and a pattern requiring a letter last misses every
sentence of it. Measured — `We will send you a link.` was missed by the letter-only form and is
caught by this one, and the clean-tree baseline is ten either way, so the widening costs nothing. This baseline is recorded because a heuristic
whose normal output is "ten things" gets ignored unless somebody wrote down which ten.

**W1 is a script, not a grep, and that is deliberate.** It used to search the component
directories for the literal strings `~/components/atoms`, `~/components/molecules` and so on.
Under Nuxt auto-imports those strings do not exist: a molecule renders `<AppStack>` with no
import statement at all, and across the whole shipped library there are two import statements
in total, neither of them a component. The grep therefore returned nothing on every run and
read as a pass. It was not clean, it was **inert** — the worst of the three states, because a
broken signal eventually gets investigated and a green one never does. The replacement checks
what this stack actually writes: rendered tags, resolved to their defining layer. Anyone
tempted to "simplify" it back into a one-line grep should read this paragraph first.

**W1 sees pages and layouts, and did not always.** It read `app/components` alone, so every
page and both layouts — twelve files — were never opened: a page rendering another page, or a
layout rendering a page, passed silently and the count printed (`43 components`) was exactly the
component count, which is what made it invisible. Pages and layouts now share one rank above
`templates`, because neither is below the other: a page is rendered *into* a layout by Nuxt and
names it in `definePageMeta`, so both may render any component and neither may render the other.
Nuxt registers neither as a component, so the illegal shape needs an explicit import — which is
checked by path as well as by tag name, because a tag-name rule can be evaded by binding the
import to a different name and a path rule cannot.

**No `Signal` in this table contains a pipe.** A markdown table cell cannot carry a bare `|`, so
a pipe ships escaped as `\|` — read raw (which is how an agent reads this file) that is a literal
backslash-pipe, and under `grep -E` it matches nothing at all. Both ways that fails are silent,
and they fail differently: a match-based signal reports no violations and reads exactly like a
clean codebase, while a `-L` signal inverted by the same escape lists *every* file including the
compliant ones, which is worse — a row that cries wolf on everything is the row that gets the
whole table ignored. Write alternation as repeated `-e` patterns, which are correct whether the
cell is read raw or rendered. Quote every `--include` glob for the same reason: unquoted, zsh
expands it against the current directory and aborts the command before grep runs.

**And prefer `+` to `{2,}` where the two say the same thing.** Not for portability of the
quantifier itself — `[A-Za-z]{2,}` is ERE and behaves identically everywhere it was tried. The
shape that breaks is a *bounded* run either side of a required pair: `>[^<>]*[A-Za-z]{2,}[^<>]*<`
matches `<p>Inline prose here</p>` under GNU and BSD grep and matches **nothing** under ugrep
7.8.4, which some developers have aliased to `grep`. `>[^<>]*[A-Za-z]+[^<>]*<` matches under all
three and surfaces no extra hit on a clean tree. Whenever a signal is written or changed, run it
against a file you have deliberately broken before believing a clean result — a pattern that
matches nothing and a codebase with nothing to find are the same output.
