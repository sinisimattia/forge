# ADR-0002: The Generator Depends On Nothing But Node

- **Status:** Accepted
- **Date:** 2026-09-17

## Context

`tools/create/` is the thing that produces a whole application before that application's
own `npm install` has ever run. It cannot lean on the ecosystem it is about to scaffold —
there is no `node_modules` yet, and there must not need to be one just to run `npm run
create`. Forge is also, itself, a small and long-lived piece of infrastructure: every
runtime or test dependency it takes on is a piece of supply-chain surface and a future
breakage someone has to chase, for a tool whose job is a handful of file operations
(prompt, copy a tree, substitute tokens, write JSON, init a git repo).

## Decision

The generator uses Node builtins only — `node:fs`, `node:path`, `node:readline/promises`,
`node:child_process` for `git`. It is tested with the Node built-in test runner
(`node --test`), not Jest or Vitest. Forge as a whole ships zero runtime dependencies and
zero test dependencies; `package.json` has no `dependencies` and no `devDependencies` at
all.

## Consequences

### Positive

- Forge itself needs no install step. A bare `git clone` plus a Node 22 runtime is enough to
  run `npm run create`, `npm test`, `npm run sanitize` — there is no lockfile drift to chase
  and nothing to audit for vulnerabilities in the generator's own supply chain.
- The generator's behavior is fully readable as plain Node — no framework indirection
  between "what the code does" and "what runs."

### Negative

- **No YAML merging, no JSON deep-merge, no templating engine.** Any file that would
  otherwise need to be assembled from pieces — a partial `ci.yml` job, a fragment of
  `package.json` — cannot be. Composition of that kind requires a library (a YAML parser at
  minimum), which the zero-dependency constraint forbids. The consequence is structural, not
  cosmetic: **every file that needs composing must instead be wholly owned by `template/`**
  and shipped complete, which is also why ADR-0001 rejects layer composition rather than
  merely finding it unnecessary.
- **This is the direct reason forge cannot validate the generated project's own CI
  workflow.** `template/.github/workflows/ci.yml` is copied into every generated project
  by the same token-substitution copy as everything else, but forge never parses it — doing
  so would need a YAML parser, and none is available without adding a dependency. A YAML
  syntax error or a bad job/step reference in that file would currently ship silently; only
  `sanitize`'s plain-text scan and the generated-project integration test's file-existence
  checks touch it at all, and neither one understands YAML structure. This is recorded here,
  and in the README, as a known limitation rather than left undiscovered — closing it later
  means either accepting a YAML-parser dependency scoped narrowly to test tooling, or writing
  a minimal structural check by hand.
