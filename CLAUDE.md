# Forge — Agent Orientation

Forge generates new application projects from one template tree. A generated project is a
working identity platform — auth, organizations, authorization, MFA and an append-only audit
log — not a scaffold with the interesting parts left out.

This file is orientation only. The authoritative record is `docs/adrs/`, which holds Forge's
own decisions about how the generator and the template work. Read the ones that bear on what
you are about to change, before you change it:

- **ADR-0001 — one template tree, copied wholesale, not layers.** Read it before proposing a
  layer system, a templating engine, or any form of partial composition.
- **ADR-0002 — the generator depends on nothing but Node.** Read it before reaching for a
  library. Its consequence (no YAML or JSON merging is possible) is the reason several things
  are shaped the way they are, and it is a deliberate trade rather than an oversight to fix.
- **ADR-0003 — extraction is copy-out only; Voku is read-only, forever.**
- **ADR-0004 — the generator contract:** what the tokens are and why those, substitution as
  the only transform, adopt mode as subset selection, and why `forge.json` is written even
  though nothing reads it. Read it before touching `tools/create/` or adding a file to
  `template/`.
- **ADR-0005 — four test tiers, and tests written to fail.** What each tier proves that the
  one below it cannot, what makes a discriminating test different, and the two traps
  (`coverage` is a separate target; `npm test` is the unit tier only) that have each cost
  this project real time.

`template/docs/adrs/` is a different set entirely — the decisions a *generated* project
inherits. Do not confuse the two.

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
| `tests/integration/` | `npm run test:integration` — generates a real project and runs its own gates; `FORGE_E2E=1 npm run test:integration` adds the Docker e2e. `npm test` runs neither (ADR-0005) |
| `docs/adrs/` | Forge's own architecture decisions (this repo, not the template's) |
| `.github/workflows/ci.yml` | Forge's own CI — the unit, generated-project, storybook and docker tiers all run on push and on PR; a weekly scheduled job re-resolves the template's lockfile |

Everything under `template/docs/`, `template/.claude/`, etc. is the template's own copy of
this same kind of material for a *generated* project — do not confuse the two: editing
`template/CLAUDE.md` changes what ships to every new project; editing this file changes
only how an agent works on Forge itself.
