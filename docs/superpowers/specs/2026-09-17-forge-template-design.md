# Forge — Application Template Workspace

**Status:** approved design, pending implementation plan
**Date:** 2026-09-17
**Source of truth for extraction:** `~/Progetti/Voku` @ `fdfdbde` (read-only)

---

## 1. Context

Voku is an NX/npm-workspaces monorepo whose *reusable* value is not its domain but its
scaffolding: a consolidated agent roster, single-source standards docs, a framework-agnostic
`libs/core` that acts as an executable contract, a containerized Node 22 dev environment, and
a documented lifecycle (`planner → core-implementer → implementers → testers ‖ reviewer →
documenter → closer → pr`).

Rebuilding that by hand for each new application is expensive and lossy. Forge extracts it
once into a standalone template workspace that generates new projects.

Forge is a **clean one-time snapshot**. It does not stay coupled to Voku, and Voku is never
modified — not now, not by forge later.

## 2. Goals

- G1. A new application, correctly structured and passing its own lint/typecheck/test/build
  gates, is one command away.
- G2. The "how we work" layer (agents, standards, docs conventions) is usable **on its own**,
  droppable into a repo that already exists.
- G3. Adding a second stack later is additive — a new directory, not a redesign.
- G4. Zero Voku domain concepts survive extraction (no Events, Tickets, Invitations/RSVP,
  Payments, refunds, Stripe, or Voku branding).

## 3. Non-goals

- N1. No changes of any kind to `~/Progetti/Voku`.
- N2. No GitHub remote creation, no push, no npm publish. Local repo only.
- N3. No drift/update tooling (`forge update`, `forge diff`). A receipt is written so this
  stays *possible*; it is not built.
- N4. No third stack beyond `nest-nuxt` and `minimal`.
- N5. Forge does not dogfood its own process layer on itself. Circular and not worth it.

## 4. Approach

**Chosen: overlay directories + manifest.** Each layer is an ordinary file tree plus a small
JSON manifest. The generator copies layers in dependency order, overlays later onto earlier,
substitutes tokens, and merges a short list of JSON files.

Rejected:

- *Template engine (Plop/Hygen).* Turning every file into a `.hbs` template makes the layers
  unrunnable and unlintable in place — you could no longer boot the stack layer to check it
  still works. Heavy machinery for what is copy-and-substitute.
- *Forge as a working monorepo whose generator strips the domain.* "Delete the right things"
  is more fragile and goes stale faster than "copy the right things", and it cannot express a
  minimal layer at all.

## 5. Repository layout

```
forge/
├── layers/
│   ├── process/          # deps: []          — stack-agnostic: agents, standards, docs
│   │   ├── layer.json    #   manifest (never copied into the target)
│   │   └── files/        #   the tree, rooted at the target repo root
│   ├── nx-base/          # deps: [process]   — NX workspace shell + empty libs/core
│   ├── nest-nuxt/        # deps: [nx-base]   — NestJS + Nuxt + the Users/auth slice
│   └── minimal/          # deps: [nx-base]   — one plain TS app, no framework
├── tools/create/         # the generator (zero runtime dependencies)
├── tests/                # unit + integration tests for the generator
├── docs/                 # forge's OWN docs (adding a layer, forge ADRs, this spec)
├── CLAUDE.md
└── README.md
```

## 6. The layer model

### 6.1 Manifest

```jsonc
// layers/<name>/layer.json
{
  "name": "nest-nuxt",
  "description": "NestJS + TypeORM/Postgres backend, Nuxt 4 webapp, shared core",
  "dependsOn": ["nx-base"],
  "merge": ["package.json", "nx.json"],
  "prompts": [
    { "token": "__FORGE_DB_NAME__", "question": "Postgres database name",
      "default": "derive:project_name_snake", "pattern": "^[a-z][a-z0-9_]*$" }
  ]
}
```

Everything under `layers/<name>/files/` is the tree, rooted at what becomes the target repo
root. `layer.json` sits beside `files/`, not inside it, so it is never copied.

### 6.2 Composition algorithm

1. Resolve preset → layer set; expand `dependsOn` transitively.
2. Topologically sort. A missing or cyclic dependency is a hard failure, named explicitly.
3. For each layer in order, walk `files/` and copy into the staging tree.
   - Default for a path that already exists: **overwrite**.
   - If the path is named in the *incoming* layer's `merge` list: **deep-merge** instead.
   - A path in a `merge` list that does not yet exist in staging is simply copied.
4. Substitute tokens (§6.4).
5. Fail if any `__FORGE_*__` token remains anywhere in the staged tree.

### 6.3 Merge semantics

**Only `.json` files may appear in a `merge` list.** This is a deliberate constraint: it keeps
the generator dependency-free (no YAML parser) and keeps merge behaviour predictable.

Deep merge, applied in layer order, incoming = the later layer:

| Case | Rule |
|---|---|
| both plain objects | recurse key-wise |
| both arrays | concatenate, then drop duplicate primitives preserving first occurrence; objects concatenated as-is |
| anything else | incoming wins |

Merge exists to stop duplication, not for cleverness. `package.json` is the real case:
`nx-base` owns `workspaces`, the `build`/`test`/`lint`/`typecheck`/`affected` scripts, `nx`,
and `engines`; `nest-nuxt` adds the `dev:*`/`prod:*` scripts and its overrides. Without merge,
both `nest-nuxt` and `minimal` would carry a full copy of nx-base's root `package.json` and
they would drift.

### 6.4 Tokens

Substituted in **file contents and in path segments**, so `libs/core/package.json` holding
`"name": "__FORGE_SCOPE__/core"` generalizes `@voku/core` correctly.

| Token | Example | Default |
|---|---|---|
| `__FORGE_NAME__` | `my-app` | prompted; `^[a-z][a-z0-9-]*$` |
| `__FORGE_TITLE__` | `My App` | derived: title-cased from name |
| `__FORGE_SCOPE__` | `@my-app` | derived: `@` + name |
| `__FORGE_DESCRIPTION__` | `An app.` | prompted, may be empty |
| `__FORGE_DB_NAME__` | `my_app` | derived: name with `-` → `_` (nest-nuxt only) |

The `__FORGE_` prefix is load-bearing. A bare `__NAME__`-style convention would make the
"no unresolved tokens" guard (§6.2, step 5) fire on legitimate shipped content - Nuxt's
`window.__NUXT__` is the obvious casualty. Namespacing lets the guard match
`__FORGE_[A-Z0-9_]*__` exactly and stay a hard failure instead of a warning.

Binary files are detected by a NUL byte in the first 8 KiB and copied verbatim, never
substituted. Extension allowlists were rejected — they surprise on unusual files.

### 6.5 Seam files

Markdown cannot be merged without a parser and heuristics, and concatenating prose produces
garbage. Instead, stable process-layer documents **link** to small, dedicated files that a
stack layer wholly owns and overwrites. This is Voku's own single-source rule ("link, don't
restate") turned on the template itself.

| Seam file | Owned by | Contents |
|---|---|---|
| `docs/standards/package-map.md` | each stack layer | the package table the root `CLAUDE.md` links to |
| `docs/standards/stack-roster.md` | each stack layer | stack-specific agents, linked from the playbook and `.claude/agents/README.md` |
| `docs/standards/toolchain.md` | each stack layer | canonical commands: build, test, lint, typecheck, dev, migrate |

`toolchain.md` is what makes `closer` and the testers genuinely stack-neutral: they read the
commands rather than hardcoding `nx`/`docker compose`. `process` ships a stub of each, so the
`process`-only preset is coherent on its own.

## 7. Layer contents

### 7.1 `process` (deps: none)

Ships roles, lifecycle, and rules — never per-package specifics.

```
CLAUDE.md                            # generic root orientation → links package-map.md
.claude/agents/                      # planner, reviewer, documenter, closer, pr + README
.claude/agent-memory/reviewer/       # .gitkeep
docs/standards/                      # README, agent-playbook, data-conventions, formatting,
                                     #   git, i18n, naming, testing, typing
                                     #   + the three seam-file stubs
docs/adrs/                           # 0000-template.md + inherited convention ADRs 0001-0004
docs/{rfcs,architecture,guides,concepts,api}/   # skeletons, each with a README
docs/superpowers/{specs,plans}/      # where brainstorming and writing-plans land
```

Agent split. The rule: process ships stack-neutral roles; stack layers ship the rest.

| Agent | Layer |
|---|---|
| `planner`, `reviewer`, `documenter`, `closer`, `pr` | `process` |
| `core-implementer`, `core-tester` | `nx-base` |
| `backend-implementer`, `backend-tester`, `webapp-implementer`, `webapp-tester` | `nest-nuxt` |

Agent frontmatter keeps Voku's shape (`name`, `description`, `model`, `color`, optional
`memory`) and its model assignments, which a generated project is free to change.

**Reviewer generalization.** Voku's `reviewer` hardcodes its backend/webapp/core dimensions.
In forge it keeps the dimension-*selection* machinery — map changed file → owning package →
run that package's checklist — but the checklists move into each package's `STANDARDS.md`
under a `## Review dimensions` section:

```markdown
## Review dimensions
| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| B1 | Controllers contain no business logic | `grep -n "await this\..*Repository" src/**/*.controller.ts` | blocking | STANDARDS.md §3 |
```

The reviewer discovers packages via `package-map.md` and reads each changed package's table.
A new stack layer therefore contributes its review dimensions with no edit to the reviewer.

**Inherited convention ADRs.** Re-authored from Voku ADRs that are reusable *conventions*
rather than product decisions, framed as defaults the generated project inherits and may
supersede:

- `0001-single-source-documentation.md` (from Voku ADR-0008's surviving rule)
- `0002-consolidated-agent-roster.md` (from ADR-0009)
- `0003-architecture-docs-describe-boundaries.md` (from ADR-0010)
- `0004-api-reference-lives-with-implementation.md` (from ADR-0013)

Voku's product ADRs (0001–0007, 0011, 0012, 0017, 0018) do not cross over.

**Scope limit, stated honestly:** `docs/standards/*` is framework-agnostic but unmistakably
TypeScript-flavored. It is not abstracted into language-neutral prose — that would remove
everything that makes it useful. `process` means "any TypeScript repo", not "any repo".

### 7.2 `nx-base` (deps: `process`)

`nx.json` (target defaults + caching), root `package.json` (workspaces `apps/*`+`libs/*`, the
NX scripts, `engines: node >=22 <23`), `eslint.config.base.mjs`, base `tsconfig`,
`.editorconfig`, `.gitignore`, `.github/workflows/ci.yml` (nx-affected on Node 22), and:

`libs/core` — the framework-agnostic package, wired but empty of domain:
`src/shared/{errors,testing,types}` (base `DomainError`, `ConformanceExpect`), `tests/`
mirroring `src/`, `package.json` with subpath `exports`, `tsconfig` with
`verbatimModuleSyntax`, jest config, `CLAUDE.md`, `STANDARDS.md`.

Agents: `core-implementer`, `core-tester`.

**Purity is enforced structurally, not only by review.** Voku relies on the reviewer agent for
core purity; there is no lint rule. Forge adds `no-restricted-imports` to
`libs/core/eslint.config.mjs` banning `typeorm`, `@nestjs/*`, `nuxt`, `vue`, `pinia`, and
`@prisma/*`. The reviewer's purity dimension remains, because lint cannot check *prose* — core
must also never name its consumers in TSDoc or comments — but import purity becomes a
guarantee rather than a check that can be skipped.

`nx-base` ships **no** `compose.yaml` and no `.env.example`; those belong to a stack.

### 7.3 `nest-nuxt` (deps: `nx-base`)

- `apps/backend` — NestJS: `src/{auth,common,db/migrations,health,i18n,users}`, `Dockerfile`,
  `project.json`, jest config, `CLAUDE.md`, `STANDARDS.md` (with its review-dimension table).
- `apps/webapp` — Nuxt 4: `app/{components,composables,fetchers,services,stores,pages,layouts,
  locales,middleware,utils,types}`, Storybook (atoms/molecules/organisms), Tailwind, vitest,
  `Dockerfile`, `CLAUDE.md`, `STANDARDS.md` (with its review-dimension table).
- `libs/core/src/users/` — the core half of the Users slice (§8), added on top of nx-base's
  `libs/core`. Layers overlay additively at file level, so this is a plain addition.
- `compose.yaml` + `compose.prod.yaml` (workspace + postgres), `.env.example`.
- Seam files: `package-map.md`, `stack-roster.md`, `toolchain.md`.
- Agents: `backend-implementer`, `backend-tester`, `webapp-implementer`, `webapp-tester`.
- `merge`: `package.json` (adds `dev:*`/`prod:*` scripts), `nx.json` (adds storybook target
  defaults).

### 7.4 `minimal` (deps: `nx-base`)

`apps/cli` — a plain TypeScript entrypoint with `tsx`/`tsup` and jest. No framework, no
Docker, no Postgres. Its own `CLAUDE.md`/`STANDARDS.md` and the three seam files.

**Accepted trade-off:** the `minimal` preset ships an empty `libs/core` and therefore no
worked example of the core-first pattern. The Users slice lives entirely in `nest-nuxt`
because a `User` entity and an `IUserService` conformance suite with no implementor would be
dead weight in a CLI project. `minimal` is for scripts and tools, where the pattern is
lighter; adding an example slice there is deliberately deferred.

## 8. The Users / auth slice

Real, kept code — not a throwaway example. Every application needs authentication, so nobody
deletes it, which is exactly what makes it a durable worked example of the core-first flow.

**Core (`libs/core/src/users/`)** — `entities/User.ts`, `contracts/IUserService.ts`,
`enums/UserRole.ts` (`USER | ADMIN`), `errors/*` (`UserNotFoundError`,
`EmailAlreadyRegisteredError`, `InvalidCredentialsError`), `types/*` (`UserJSON`,
`CreateUserInput`), `testing/runIUserServiceContract.ts` + fixtures. TSDoc on every export.

**Backend** — `auth/` (JWT strategy, guards, decorators, login/register/refresh DTOs),
`users/` implementing `IUserService`, the initial TypeORM migration, and a conformance test
driving the core suite against the real service.

**Webapp** — `app/services/user.service.ts` implementing the *same* `IUserService` over HTTP,
driven by the *same* conformance suite; `auth.fetcher.ts`, `useAuth` composable, auth store,
login/register pages, route middleware.

That both apps implement one contract, checked by one suite, is the distinctive property of
this architecture, and the slice exists primarily to demonstrate it.

**Stripped from Voku:** optional guest auth and guest tokens (Voku ADR-0004), event-scoped
roles, and every domain-coupled auth path. `UserRole` is reduced to `USER | ADMIN` — a role
enum is harder to add later than to delete.

## 9. The generator

```
npm run create -- --name <kebab>
                  [--title <s>] [--scope <@s>] [--description <s>]
                  [--preset full|minimal|process] [--layers a,b,c]
                  [--out <parent-dir>] [--into <existing-dir>]
                  [--force] [--no-git] [--yes]
```

`--preset` and `--layers` are mutually exclusive. `--out` defaults to the current working
directory; the target is `<out>/<name>`.

Presets: `full` = process+nx-base+nest-nuxt · `minimal` = process+nx-base+minimal ·
`process` = process alone (G2).

Zero runtime dependencies — `node:fs`, `node:path`, `node:readline/promises` on Node 22.

Pipeline:

1. **Resolve** preset/layers → transitive closure → topological sort.
2. **Prompt** for anything unanswered, including layer-declared prompts. `--yes` takes all
   derivable defaults and fails on anything genuinely required.
3. **Stage** into a temp directory — never the target. Copy in order, overwrite by default,
   deep-merge the JSON files each incoming layer names.
4. **Substitute** tokens in contents and paths; fail on any surviving `__FORGE_*__`.
5. **Commit** — refuse a non-empty target unless `--force`; atomically rename temp → target.
   A failed run leaves nothing behind, so there is never a half-generated repo to clean up.
6. **Seal** — write `forge.json`, then `git init` + one initial commit unless `--no-git`.
7. **Report** next steps.

`--into <existing>` is the G2 path: it **never overwrites**. Existing files are skipped and
listed in a closing report so you can merge them by hand.

`forge.json` receipt — `{ forgeCommit, generatedAt, preset, layers[], tokens{} }`. All token
values are non-secret by construction. It costs one line and keeps N3 possible later.

Exit codes: `0` success · `1` validation error · `2` target conflict · `3` internal error.

## 10. Testing

**Unit** (`tools/create/__tests__/`) — the three pieces with real logic: topological sort
(including cycle and missing-dependency detection), deep merge (table-driven across the three
cases), token substitution (including binary passthrough and path substitution).

**Integration** (`tests/integration/`) — for each preset: generate into a temp directory,
assert the file inventory, then run `npm install && npm run lint && npm run typecheck &&
npm run test && npm run build` *inside the generated repo*. If a generated repo cannot pass
its own gates, forge is broken, and only running them proves otherwise.

**Docker e2e** — for `full`: `docker compose up -d`, poll `/health` until 200, tear down.
Gated behind `FORGE_E2E=1` so the default suite needs no Docker; CI sets it.

**Discriminating (negative) tests.** A green suite is not evidence on its own; each of these
asserts a *failure* that must occur:

| # | Injected fault | Must fail |
|---|---|---|
| D1 | fixture layer containing an unresolved `__FORGE_MISSING__` token | generation, exit 1 |
| D2 | `import { Repository } from 'typeorm'` added to `libs/core/src/shared/` in a generated repo | `npm run lint` |
| D3 | an assertion removed from the `IUserService` conformance suite | the backend conformance test |
| D4 | two layers both defining `scripts.test`, plus nx-base-only scripts | merge must keep the nx-base-only scripts *and* let the later `test` win — proves merge ≠ overwrite |
| D5 | `grep -ri voku layers/ tools/` | must return zero hits (G4) |

CI: unit + integration on every push; the Docker matrix on PRs.

## 11. Extraction procedure

Voku is read-only throughout (N1).

1. Copy **by explicit per-file allowlist**, never `cp -r` of a package. This structurally
   excludes `node_modules/`, `dist/`, `coverage/`, `.git/`, `.nx/`, `storybook-static/`, and
   any `.env`, rather than relying on ignore patterns to catch them.
2. Generalize: strip Voku domain code and naming; replace `@voku/*` and `Voku` with
   `__FORGE_SCOPE__`/`__FORGE_TITLE__`; rewrite the four convention ADRs; split agents by layer;
   rewrite `reviewer` for table-driven dimension discovery; extract the seam files.
3. **Sanitization gate before the first content commit** — grep the staged layers for
   `sk_`, `pk_live`, `SECRET=`, `PASSWORD=`, `BEGIN .* PRIVATE KEY`, and `voku` (case
   insensitive). All must return zero hits. This is D5, run as a gate rather than only a test.
4. **Verify the constraint:** `git -C ~/Progetti/Voku status --porcelain` must be empty, and
   `git -C ~/Progetti/Voku rev-parse HEAD` must still be `fdfdbde`.

## 12. Deltas from the approved outline

Four changes surfaced while specifying, all flagged rather than made silently:

1. **No YAML merging.** `compose.yaml` is wholly owned by the stack layer (only ever one is
   selected), and `nx-base` ships none. `merge` is restricted to JSON. This removes the only
   thing that would have forced a dependency. Merge still earns its place for
   `package.json`/`nx.json` (§6.3).
2. **Seam files introduced** (§6.5) — needed because the root `CLAUDE.md`, the playbook, and
   the agents README all contain stack-specific content in otherwise stable process files.
   `toolchain.md` additionally removes hardcoded commands from `closer` and the testers.
3. **The Users slice lives entirely in `nest-nuxt`**, not split into `nx-base`, so `minimal`
   does not inherit a contract with no implementor (§7.4).
4. **Core purity gains a lint rule** (§7.2), upgrading Voku's review-only check to a
   structural guarantee. The prose-level reviewer dimension stays, since lint cannot read
   TSDoc intent.

## 13. Deferred

- `forge update` / drift detection (receipt written, tooling not built).
- A third stack layer.
- An example slice for `minimal`.
- Publishing forge to a remote or to npm.
