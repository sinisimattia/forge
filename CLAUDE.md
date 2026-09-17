# Forge — Agent Orientation

Forge generates new application projects from one template tree. This file is orientation
only. The authoritative documents are:

- **Design spec:** `docs/superpowers/specs/2026-09-17-forge-template-design.md` — goals,
  non-goals, repository layout, the token table, the generator's CLI, template contents, and
  the testing strategy (including the discriminating-test table). Read this before touching
  `tools/create/` or `template/`.
- **Phase 1 plan:** `docs/superpowers/plans/2026-09-17-forge-phase-1-generator-and-template-skeleton.md`
  — the task-by-task build-out this repository's history follows. Later phases (identity
  foundation, tenancy, authorization, audit) are planned but not yet built; see the spec's
  §14 "Deferred" and the plan's own "Next" pointer.
- **ADRs:** `docs/adrs/0001` through `0003` record why the generator looks the way it does
  (single template, not layers; zero dependencies; Voku is read-only). Read these before
  proposing a layer system, a templating engine, or any dependency on the generator.

## Three rules an agent working on Forge must not break

1. **`~/Progetti/Voku` is read-only. Always.** Never write to it, never run a command there
   that could change tracked or untracked state. Before and after any Forge task, confirm
   `git -C ~/Progetti/Voku status --porcelain` is empty and `git -C ~/Progetti/Voku
   rev-parse HEAD` is unchanged. Forge extracted from Voku once; it never modifies it and
   never reads from it as a live dependency (ADR-0003).
2. **The generator takes no dependencies.** `tools/create/` and every test in `tests/`
   use Node builtins only, tested with `node --test`. Forge's `package.json` has no
   `dependencies` and no `devDependencies`. Do not add one to solve a problem — the
   consequence of this constraint (no YAML/JSON merging is possible) is recorded in
   ADR-0002, and it is a deliberate trade, not an oversight to "fix."
3. **`npm run sanitize` must pass before any commit that touches `template/`.** It is the
   gate that catches a source-project trace (`voku`), a leaked domain concept, or a
   populated secret before it ships in what is supposed to be a generic template. Run it,
   don't skip it, and don't weaken its rules to make a commit pass.

## Where things live

| Path | What it is |
|---|---|
| `template/` | THE template — a complete, bootable NX/NestJS/Nuxt monorepo, copied wholesale by the generator |
| `tools/create/` | the generator (zero runtime dependencies) |
| `tools/sanitize.mjs` | the extraction gate — scans `template/` and `tools/` for source-project traces and secrets |
| `tests/unit/` | fast tests: token substitution, adopt-mode subset selection, never-overwrite |
| `tests/integration/` | generates a real project and runs its own gates; the Docker e2e (`FORGE_E2E=1`) |
| `docs/superpowers/{specs,plans}/` | the design spec and the phase plan |
| `docs/adrs/` | Forge's own architecture decisions (this repo, not the template's) |
| `.github/workflows/ci.yml` | Forge's own CI — unit tier on every push, generated-project/storybook/docker tiers on PRs |

Everything under `template/docs/`, `template/.claude/`, etc. is the template's own copy of
this same kind of material for a *generated* project — do not confuse the two: editing
`template/CLAUDE.md` changes what ships to every new project; editing this file changes
only how an agent works on Forge itself.
