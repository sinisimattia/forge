# Forge

Forge generates new application projects from **one template**: an NX/npm-workspaces
monorepo with a NestJS + TypeORM + PostgreSQL backend, a Nuxt 4 / Vue 3 webapp, a
framework-agnostic `libs/core` domain layer, and the full "how we work" layer — a
consolidated agent roster, single-source standards docs, and ADRs.

There is exactly one template and exactly one way to generate a project (no presets, no
stack variants, no layer composition — see `docs/adrs/0001-single-template-not-layers.md`).
The generator itself has zero runtime dependencies (`docs/adrs/0002-dependency-free-generator.md`)
and was extracted once, read-only, from a real monorepo (`docs/adrs/0003-extraction-is-copy-out-only.md`).

## What exists today

Phase 1 (this repository's current state) ships the generator and a **skeleton** template:
the workspace shell (NX, ESLint, TypeScript, Docker Compose, CI), the agent/docs layer, a
`libs/core` with the purity pattern and shared building blocks (`DomainError`, the
conformance-testing helpers, branded ID types), a NestJS backend with a `/health` endpoint
and its common infrastructure (i18n, error filter, pagination types, a migrations folder),
and a Nuxt webapp with one component, one page, and its test/Storybook setup wired up.

The identity, tenancy and authorization platform described in the design spec (`docs/
superpowers/specs/2026-09-17-forge-template-design.md`, §9 — users, auth identities,
sessions, MFA, organizations, permissions, audit log) is **designed but not yet built** — it
lands in later plans (see that spec's §14 "Deferred" and the phase plan's "Next"). Don't
expect a generated project to have login or organizations today; it has a project that
boots, passes its own gates, and is ready for that work to be added.

## Quick start

```bash
npm run create -- --name my-app
```

This prompts for anything you didn't pass on the command line, stages the new project in a
sibling directory next to the target (`<out>/.forge-staging-<random>`, not `os.tmpdir()` —
the OS temp directory is often a different filesystem, where `fs.rename` fails with `EXDEV`;
staging as a sibling keeps the final move on the same filesystem so it can be a real atomic
rename), substitutes tokens, and only then atomically moves it into place — a failed run
leaves nothing behind. Useful flags:

```bash
npm run create -- --name my-app \
  --title "My App" \
  --scope @my-app \
  --description "An app." \
  --db-name my_app \
  --out ~/projects \
  --no-git \
  --yes
```

- `--out` defaults to the current directory; the project lands at `<out>/<name>`.
- `--no-git` skips `git init` and the initial commit.
- `--yes` accepts every derived default and skips prompts (useful in scripts/CI).

Once generated:

```bash
cd my-app
npm install
npm run dev:up   # backend + webapp + Postgres, containerized, Node 22
```

### Adopt mode

To bring just the "how we work" layer — agents, standards, ADRs — into a repository that
already exists, without touching its application code:

```bash
npm run create -- --into ~/existing-repo
```

Adopt mode copies only the declared **process subset** (`CLAUDE.md`, `.claude/agents/**`,
`.claude/agent-memory/**`, `docs/standards/**`, `docs/adrs/0000-template.md` and
`docs/adrs/0001`–`0004`) and **never overwrites an existing file** — anything already
present at a destination path is skipped and listed in the closing report.

**Precondition: a comparable package layout.** The adopted agent prompts point at
`libs/core/STANDARDS.md`, `apps/backend/STANDARDS.md` and `apps/webapp/STANDARDS.md` for
their package-specific rules and review dimensions — none of those three files is itself
part of the process subset (they're template-specific content, not "how we work"). Adopt
mode does not create them, check for them, or require a `libs/core`/`apps/backend`/
`apps/webapp` layout to exist. If the target repo has no comparable file at one of those
paths, the corresponding agent's pointer dangles: `reviewer`, for instance, discovers its
review dimensions from each package's `STANDARDS.md`, so in a repo missing all three it
finds zero dimensions to check and reports every package clean — not because the code is
clean, but because it found nothing to check it against. Adopting the process layer into a
repository with a substantially different layout means either writing equivalent
`STANDARDS.md` files at those three paths yourself, or expecting the adopted agents'
package-specific guidance to be inert until you do. The closing report names these three
paths after every adopt run as a reminder.

## What a generated project contains

```
my-app/
├── CLAUDE.md, README.md, forge.json          # forge.json is the extraction receipt
├── package.json, nx.json, tsconfig.base.json, eslint.config.base.mjs
├── compose.yaml, compose.prod.yaml, .env.example
├── .github/workflows/ci.yml
├── .claude/agents/ (11 agents + README), .claude/agent-memory/
├── docs/{standards,adrs,rfcs,architecture,guides,concepts,api,superpowers}/
├── libs/core/        → shared/ (DomainError, conformance testing, branded types)
└── apps/
    ├── backend/      → health, common (i18n/filters/interceptors/pipes/types), db/migrations
    └── webapp/       → one atom component, one page, Storybook + Vitest wired up
```

`npm install && npm run dev:up` gives you a running stack with a working `/health` endpoint,
NX-driven `lint`/`typecheck`/`test`/`build` across all three packages, and a
`libs/core` purity gate (`npm run purity -w libs/core`) — with no source-project domain
code to delete first.

## Changing the template

`template/` is an ordinary, complete, bootable monorepo — not a set of `.hbs` files. Edit it
directly: `cd template && npm install` and treat it like any other project while you work.
Before committing anything that touches `template/`, run the full suite from the Forge root:

```bash
npm run test:all
```

This runs, in order: `npm run sanitize` (the extraction gate — must be clean), `npm test`
(the generator's own unit tests), and `npm run test:integration` (generates a real project
and asserts it passes its own `lint`/`typecheck`/`test`/`build`/`purity`; set `FORGE_E2E=1`
to also boot the generated stack in Docker and check `/health`). The integration tier is
slow — a generated project's `npm install` plus a Nuxt build, and the Docker tier adds image
builds on top — budget real time for it rather than expecting it to finish like the unit
tier.

## Tokens

Substituted in both file contents and path segments (so `libs/core/package.json`'s
`"name": "__FORGE_SCOPE__/core"` generalizes `@voku/core` correctly). The generator fails if
any `__FORGE_[A-Z0-9_]*__` token survives substitution.

| Token | Example | Source |
|---|---|---|
| `__FORGE_NAME__` | `my-app` | prompted; must match `^[a-z][a-z0-9-]*$` |
| `__FORGE_TITLE__` | `My App` | derived: title-cased from name |
| `__FORGE_SCOPE__` | `@my-app` | derived: `@` + name |
| `__FORGE_DESCRIPTION__` | `An app.` | prompted, may be empty |
| `__FORGE_DB_NAME__` | `my_app` | derived: name with `-` → `_`; `^[a-z][a-z0-9_]*$` |

Binary files are detected by a NUL byte in the first 8 KiB and copied verbatim, untouched by
token substitution.

## CI

`.github/workflows/ci.yml` runs three tiers:

- **unit** — every push and PR: `npm run sanitize` (must run first — it's the cheapest gate
  and the one that catches an extraction mistake), then `npm test`.
- **generated-project** — PR-only: generate a real project and run its own gates (`npm run
  test:integration`).
- **storybook** — PR-only, and currently **non-blocking** (`continue-on-error: true`):
  builds the template's Storybook (`nx run webapp:build-storybook`, a target `nx run-many
  -t build` never invokes on its own, so it needs its own step to be exercised at all). It
  is not yet a hard gate because it currently fails for a known, pre-existing reason — see
  "Known limitations" below.
- **docker** — PR-only and slowest: `npm run test:integration` with `FORGE_E2E=1`, which
  boots the generated stack for real and asserts `/health` returns `{"status":"ok"}`.

Forge has no runtime or test dependencies, so there is no lockfile and no `npm ci`/`npm
install` step for Forge's own `package.json` in this workflow — there is nothing to install.
(`npm ci` was checked directly against this repo before writing the workflow: with no
`package-lock.json` present it fails immediately, it does not treat "nothing to install" as
success — so it is deliberately never invoked here.) The generated projects created inside
the integration/storybook/docker steps are a separate `package.json` tree and do get an
explicit `npm install`.

## Known limitations

- **The generated project's own `.github/workflows/ci.yml` is never parsed or validated.**
  It's copied wholesale from `template/.github/workflows/ci.yml` like every other file, and
  checked only by `sanitize`'s plain-text scan and the integration test's file-existence
  assertion — neither understands YAML structure. A YAML syntax error or a bad job/step
  reference in that file would ship silently today. Validating it would need a YAML parser,
  which conflicts with the zero-dependency constraint (`docs/adrs/0002-dependency-free-generator.md`)
  — this is accepted as a known gap rather than an oversight.
- **Generated projects are not reproducible — the template ships no `package-lock.json`.**
  Every `npm install` inside a generated project resolves each dependency's version range
  fresh, against whatever is newest on the registry that day, rather than against a set of
  versions known to work together. The first observed casualty of this is the template's
  own Storybook: it fails on a plain, freshly generated project with
  `[vite:build-html] Missing field 'moduleType'` while building `iframe.html` — a
  Storybook/Vite version-resolution mismatch, unrelated to any story's content. The CI
  `storybook` job runs this build and surfaces the failure, but is currently
  `continue-on-error: true` (non-blocking) precisely because the cause is this drift, not a
  regression to fix per-PR. Whether the template should ship a lockfile to pin its
  dependency graph is a real trade-off (reproducible builds vs. one more file for the
  generator to keep in sync and one more thing extraction has to regenerate) and is an open
  decision, not yet made.
- **No drift/update tooling.** A generated project's `forge.json` records the Forge commit
  it was generated from, so re-syncing against a newer template stays *possible*, but no
  tooling to do it exists yet (`docs/adrs/0003-extraction-is-copy-out-only.md`).
- **The identity/tenancy/authorization platform in the design spec (§9) is not yet built** —
  see "What exists today" above.

## More

- Design spec: `docs/superpowers/specs/2026-09-17-forge-template-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-09-17-forge-phase-1-generator-and-template-skeleton.md`
- ADRs: `docs/adrs/`
- Agent orientation: `CLAUDE.md`
