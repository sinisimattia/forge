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

The generator, and a template that is a working **identity foundation** rather than a
skeleton. A generated project boots, signs people up, verifies their address, signs them in
and out, lets them change a password, recover a forgotten one, manage their profile and see
and revoke their own sessions — and it passes its own gates on the way out of the generator.

- **`libs/core`** — the framework-agnostic domain. Five domains (`users`, `identities`,
  `auth`, `audit`, `authorization`) plus `shared`. `authorization/` is a pure function over
  facts the caller passes in, never an ambient lookup
  (`docs/adrs/0006-authorization-is-a-pure-function-in-core.md`); it therefore has policies
  and types where the other four have a `contracts/` service port. Each of those four domain
  service ports ships an executable conformance suite under `testing/` — `auth` has a second
  one for its security properties — and the backend runs every one of them against its own
  implementation, so "the adapter satisfies the contract" is a test, not a review note.
  Every subpath in `libs/core/package.json`'s `exports` resolves to a real barrel on disk,
  and every barrel on disk is exported; Forge's gate asserts that in both directions.
- **`apps/backend`** — NestJS. Registration, email verification, sign-in/out, password
  change and reset, profile, session listing and revocation, an append-only audit log, and
  `/health`. Mail leaves through a port, not a vendor
  (`docs/adrs/0008-ports-not-vendors.md`) — the shipped adapter writes messages to disk, so
  a generated project works end to end with nothing to sign up for. Three migrations build
  the schema, the last of which takes `UPDATE`/`DELETE` on the audit table away from the
  application role at the database.
- **`apps/webapp`** — Nuxt 4. The whole auth surface (sign in, register, forgot/reset
  password, verify email) plus an account area, over an Atomic Design component library.
  The layering is enforced by a checker, not a convention: `npm run layers -w apps/webapp`
  resolves every rendered tag and every cross-layer import to the layer that defines it,
  and fails if it finds nothing to scan.

What is **not** built yet: organizations and tenancy (`docs/adrs/0007-tenancy-is-explicit-never-ambient.md`
records the decision, and every contract method that acts on somebody's record already takes
an explicit `actorId` rather than resolving a caller from ambient state, but there is
no `Organization` entity and the audit log's `organizationId` is a plain string that is
always `null` this phase), MFA, OAuth/social sign-in, and WebAuthn. See the design spec's §14
"Deferred" and the Phase 2 plan's "Next".

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
npm run dev:up   # backend + webapp + Postgres, containerized, Node 22
```

`dev:up` installs inside the containers from the committed `package-lock.json`; a host
`npm install` (or `npm ci`) is optional, and only useful for local editor tooling.

### Adopt mode

To bring just the "how we work" layer — agents, standards, ADRs — into a repository that
already exists, without touching its application code:

```bash
npm run create -- --into ~/existing-repo
```

Adopt mode copies only the declared **process subset** (`tools/create/subset.mjs`'s
`PROCESS_SUBSET`): `CLAUDE.md`, `.claude/agents/**`, `.claude/agent-memory/**`,
`docs/standards/**`, and the ADRs that describe how we work — `0000-template.md` through
`0004`. The platform ADRs (`0005`–`0008`) are deliberately not in it: they are decisions
about *this* template's identity architecture, not about how a team works, and they would
be false in a repository that had adopted only the process layer. Adopt mode **never
overwrites an existing file** — anything already present at a destination path is skipped
and listed in the closing report.

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
├── package.json, package-lock.json, nx.json, tsconfig.base.json, eslint.config.base.mjs
├── compose.yaml, compose.prod.yaml, .env.example
├── .github/workflows/ci.yml
├── .claude/agents/ (11 agents + README), .claude/agent-memory/
├── docs/{standards,adrs,rfcs,architecture,guides,concepts,api,superpowers}/
├── libs/core/        → users/ identities/ auth/ audit/ authorization/ shared/
│                       grouped by kind — entities/ types/ enums/ errors/ policies/, and
│                       contracts/ + testing/ where a domain has a service port. Every
│                       group that exists is a subpath export; the gate checks both ways.
└── apps/
    ├── backend/      → auth, identities, users, audit, mail (a port), health,
    │                   common (i18n, filters, interceptors, pipes, crypto, …), db/migrations
    └── webapp/       → pages (auth + account), an Atomic Design component library,
                        stores, composables, fetchers, Storybook + Vitest wired up
```

`npm run dev:up` gives you a running stack with a working `/health` endpoint. Across all
three packages the project ships NX-driven `lint`, `typecheck`, `test` and `build`, plus two
gates that are **not** in any `run-many` list and so need naming explicitly:

```bash
npm run purity -w libs/core     # core names no framework or transport, in code or in prose
npm run layers -w apps/webapp   # a component renders only layers below its own
```

Both are in the root `affected` script (`nx affected -t lint test build typecheck purity
layers`), which is what a project's own CI should run. Forge's generated-project gate runs
each of them by name, because `nx run-many -t build` and friends never reach them.

## Changing the template

`template/` is an ordinary, complete, bootable monorepo — not a set of `.hbs` files. Edit it
directly: `cd template && npm install` and treat it like any other project while you work.
Before committing anything that touches `template/`, run the full suite from the Forge root:

```bash
npm run test:all
```

This runs, in order: `npm run sanitize` (the extraction gate — must be clean), `npm test`
(the generator's own unit tests), and `npm run test:integration` (generates a real project
and asserts it passes its own `lint`/`typecheck`/`test`/`build`/`purity`/`layers`; set
`FORGE_E2E=1` to also boot the generated stack in Docker and check `/health`). The
integration tier is slow — a generated project's `npm ci` plus a Nuxt build, and the Docker
tier adds image builds on top — budget real time for it rather than expecting it to finish
like the unit tier. It installs with `npm ci`, not `npm install`, so the committed
`package-lock.json` is exercised by the same command the Dockerfiles and `dev:up` use: a
lockfile that had fallen out of sync with a `package.json` would otherwise pass the whole
gate and fail on the user's first boot.

### The discriminating tests

The design spec's §11 "Testing" lists fifteen faults, D1–D15, each with the observation
that must catch it. A gate that only ever runs against correct code proves nothing, so the
ones Forge itself owns are enforced by **injecting the fault and watching the gate fail**:

| | Fault injected | Caught by | Enforced in |
|---|---|---|---|
| D1 | an unresolved `__FORGE_MISSING__` token | generation aborts, leaves nothing behind | `tests/integration/create.test.mjs` |
| D2 | `import { Repository } from 'typeorm'` in a real core entity, in static, dynamic and `require()` form | `npx nx lint core` — each form's own rule message asserted | `tests/integration/generated-project.test.mjs` |
| D4 | adopt mode over a repo that already has `CLAUDE.md` | the file is left byte-identical and reported as skipped | `tests/integration/create.test.mjs` |
| D5 | a source-project trace or a populated secret anywhere in `template/` or `tools/` | `npm run sanitize` | `tools/sanitize.mjs`, run by both tiers |
| D14 | a TSDoc line naming a JWT and a cookie in a real core contract | `npm run purity -w libs/core` — both terms asserted, not just the first | `tests/integration/generated-project.test.mjs` |

D2 and D14 are injected into files that were already there — `libs/core/src/auth/entities/Session.ts`
and `libs/core/src/auth/contracts/IAuthService.ts` — and restored afterwards. A probe file
the test writes for itself only ever proves the guard covers the directory the probe was
written into.

The rest are behaviours of the generated application, not of Forge, and are enforced inside
the generated project's own suites — which Forge's gate runs wholesale via `npm run test`,
without asserting them one by one. Of those, **D3** (`*.conformance.spec.ts` in each backend
domain, running core's suites against the real adapter), **D6** (`auth/__tests__/global-guard.spec.ts`),
**D7** (`auth/__tests__/enumeration-safety.spec.ts`), **D8** (`auth/__tests__/refresh-rotation.spec.ts`)
and **D13** (`db/__tests__/migration-sql.spec.ts` — which says in its own header that it reads
the migration text and is *not* itself the database-level guarantee) have specs today.
**D9–D12 and D15 do not, and cannot**: they describe organizations, MFA, OAuth and resource
grants, none of which is built yet.

## Tokens

Substituted in both file contents and path segments (so `libs/core/package.json`'s
`"name": "__FORGE_SCOPE__/core"` generalizes correctly). The generator fails if any
`__FORGE_[A-Z0-9_]*__` token survives substitution.

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

`.github/workflows/ci.yml` runs four push/PR jobs and one scheduled one:

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
- **lockfile-refresh** — schedule-only (weekly): regenerates `template/package-lock.json`
  from scratch and runs the generated-project gate against the result, so dependency drift
  surfaces here rather than the day someone deletes `node_modules`. It never commits.

Forge has no runtime or test dependencies, so there is no lockfile and no `npm ci`/`npm
install` step for Forge's own `package.json` in this workflow — there is nothing to install.
(`npm ci` was checked directly against this repo before writing the workflow, and again
while extending it: with no `package-lock.json` present it fails immediately with `EUSAGE`,
it does not treat "nothing to install" as success — so it is deliberately never invoked
here.) The generated projects created inside the integration/storybook/docker steps are a
separate `package.json` tree, ship their own `package-lock.json`, and do get an explicit
install.

## Known limitations

- **The generated project's own `.github/workflows/ci.yml` is never parsed or validated.**
  It's copied wholesale from `template/.github/workflows/ci.yml` like every other file, and
  checked only by `sanitize`'s plain-text scan and the integration test's file-existence
  assertion — neither understands YAML structure. A YAML syntax error or a bad job/step
  reference in that file would ship silently today. Validating it would need a YAML parser,
  which conflicts with the zero-dependency constraint (`docs/adrs/0002-dependency-free-generator.md`)
  — this is accepted as a known gap rather than an oversight.
- **The template's Storybook build fails on a freshly generated project, for a reason that
  is still unknown.** `template/package-lock.json` pins the whole workspace (root,
  `libs/core`, `apps/backend`, `apps/webapp`), and a generated project installs against it
  with `npm ci` — this fixed the general reproducibility problem the template used to have
  (two builds a week apart no longer resolve different dependency trees), and it fixed
  `npm ci` inside the Dockerfiles, which previously needed a host `npm install` first just
  to produce a lockfile for `COPY package-lock.json` to find.
  It did **not** fix Storybook. The lockfile pins the exact combination once believed to be
  the cause (`@storybook/builder-vite@9.1.2`, `@storybook/vue3-vite@9.1.2`,
  `@rolldown/pluginutils@1.0.1` — all three re-checked against the current lockfile), and
  `npx nx run webapp:build-storybook` still fails identically on a generated project:
  `✓ 0 modules transformed`, then `[vite:build-html] Missing field 'moduleType'` while
  building `iframe.html`. That disproves the dependency-drift hypothesis this project
  previously recorded (see `docs/superpowers/phase-1-decision-log.md`) — the exact same
  resolved versions still fail, lockfile or not. Note that a `storybook-static/` directory
  is produced even by the failed run, so its existence is not evidence of a successful
  build. The `storybook` CI job stays `continue-on-error: true` (non-blocking) pending real
  root-causing of this failure. Do not re-attribute it to "no lockfile" without re-testing
  — that specific fix has been tried and did not work.
- **No drift/update tooling.** A generated project's `forge.json` records the Forge commit
  it was generated from, so re-syncing against a newer template stays *possible*, but no
  tooling to do it exists yet (`docs/adrs/0003-extraction-is-copy-out-only.md`).
- **Organizations, tenancy, MFA, OAuth and WebAuthn are not built** — see "What exists
  today" above.

## More

- Design spec: `docs/superpowers/specs/2026-09-17-forge-template-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-09-17-forge-phase-1-generator-and-template-skeleton.md`
- Phase 2 plan: `docs/superpowers/plans/2026-09-18-forge-phase-2-identity-foundation.md`
- ADRs: `docs/adrs/`
- Agent orientation: `CLAUDE.md`
