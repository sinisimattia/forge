# ADR-0001: One Template Tree, Copied Wholesale — Not Layers

- **Status:** Accepted
- **Date:** 2026-09-17

## Context

Forge needs a way to turn "NX + NestJS/TypeORM/Postgres + Nuxt 4/Vue 3, with the agent
roster and standards docs" into a runnable new project. An earlier design (v1, superseded)
tried to make this general: a layer system — a dependency graph between layers, a
topological sort to order them, a JSON deep-merge to combine their `package.json`/`nx.json`
fragments, and "seam" files marking where one layer's output continues into the next. The
appeal was mixing and matching: a `nestjs` layer, a `nuxt` layer, maybe someday an `express`
or `react` layer, composed per project.

That machinery was never worth its cost here, because Forge only ever needs to produce one
kind of project. There is no second stack in scope — Forge produces NX + NestJS/TypeORM/
Postgres + Nuxt 4/Vue 3 and only that — so a general composition engine
would be solving a problem Forge doesn't have, at the price of a merge algorithm that has to
be right for every file type it touches (JSON, YAML, TypeScript, Markdown) and a template
that is no longer a single tree you can read top to bottom.

Template engines (Plop/Hygen-style `.hbs` files) were considered too, and rejected for a
sharper reason: turning every file into a template file makes the template unrunnable in
place. You could no longer `cd template/ && npm install && npm run build` to check the thing
you're about to ship actually works — you'd have to render it first. That check turned out
to matter a lot in practice: the generated-project integration test (`tests/integration/
generated-project.test.mjs`) works precisely because `template/` already looks and behaves
like an ordinary monorepo, so generating a project and running `lint`/`typecheck`/`test`/
`build`/`purity` against the copy is a real end-to-end check, not a simulation.

## Decision

`template/` is one ordinary, complete, bootable monorepo, rooted at what will become the
generated repo's root. The generator (`tools/create/`) copies this tree wholesale into a
staging directory, substitutes the `__FORGE_*__` tokens in file contents and path segments,
and fails if any token survives unresolved. There is no layer graph, no merge step, no
partial composition of any kind: exactly one way to generate a project, with no composition,
no variants and no matrix.

## Consequences

### Positive

- The template is always in a runnable state. It can be linted, typechecked, tested and
  built directly, in place, without rendering anything first — which is also what makes the
  generated-project gate (`npm run test:integration`) a meaningful check rather than a
  simulation of one.
- No merge algorithm to write, maintain, or get wrong across JSON, YAML, TypeScript and
  Markdown. A contributor reading `template/` sees exactly what a generated project will
  contain — there is no second file describing how pieces combine.
- Onboarding a new contributor to Forge itself is one sentence: "`template/` is the output,
  read it directly."

### Negative

- Adding a second stack — a different backend framework, a different frontend framework, an
  additional variant of the same stack — has no first-class path. It means either a second,
  largely-duplicate template tree selected some other way, or forking Forge outright. There
  is no way to mix and match pieces of two stacks.
- This is accepted deliberately: a second stack is explicitly outside what Forge sets out to
  do. The stack is fixed at NX + NestJS/TypeORM/Postgres + Nuxt 4/Vue 3, and mixing in
  another is not a capability anyone is owed here. If that ever changes, it is a new design
  decision that supersedes this one — not a feature to bolt on top of the current generator.
