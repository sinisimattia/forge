# Shared Coding Standards

This directory holds the **framework-agnostic** coding standards shared by both the
`backend` (NestJS) and `webapp` (Nuxt) apps. Both consume this directory as the
top-level `docs/` folder of the monorepo — read-only reference material (never edit
shared docs from within a package; docs win on conflict).

These files capture the rules that are common to both apps. Framework-specific
mechanics (NestJS module layout, Nuxt Atomic Design, etc.) live in each package's
`STANDARDS.md`, which links back here. Where a rule already has an
authoritative ADR or RFC, that document remains the source of truth and these
files link to it rather than restating it.

## Index

| Document | Description |
|----------|-------------|
| [naming.md](naming.md) | Descriptive names over short ones; the forbidden-abbreviation list and acceptable exceptions. |
| [typing.md](typing.md) | No `any`; minimal `never`; explicit return types; named types in dedicated files; documented exports. |
| [i18n.md](i18n.md) | The i18n philosophy — no hard-coded user-facing text; English-only; add the key first. |
| [testing.md](testing.md) | Testing philosophy — at least one test per unit, happy path plus an error case, mock externals, co-locate. |
| [formatting.md](formatting.md) | ESLint (`@stylistic`) owns formatting — Prettier retired; one shared house style; line width is warn-only. |
| [git.md](git.md) | Commit and branch conventions. |
| [data-conventions.md](data-conventions.md) | Money as integer cents, dates in UTC, enums from the canonical source. |
| [agent-playbook.md](agent-playbook.md) | The unified agent roster and lifecycle shared by both apps. |
