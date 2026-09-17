# ADR-0003: Architecture Docs Describe Boundaries

- **Status:** Accepted
- **Date:** 2026-09-17
- **Relates to:** [ADR-0001](0001-single-source-documentation.md)

## Context

Architecture documentation has a natural tendency to grow into an inventory: a
file-by-file directory tree enumerating every module, controller, service, component, and
entity, plus per-route or per-component implementation notes. That content is a snapshot
of the code. It lives in a shared docs layer that no build step keeps in sync with the
packages it describes, so it drifts — the exact failure single-source documentation
(ADR-0001) exists to prevent. An architecture doc that lists every field of every entity
is a second, unenforced copy of `__FORGE_SCOPE__/core`.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

`docs/architecture/*` describes **boundaries, contracts, and decisions** — not code
inventories.

Keep:

- How packages fit together and how they communicate (the contract surface between
  them).
- Rendering, deployment, and infrastructure **decisions**.
- Data-model relationships and error/response conventions, described conceptually.
- Domain / bounded-context organization — *what* a part of the system is responsible
  for — described as domains, not the framework mechanics used to realize it in any one
  package.

Do not keep:

- Exhaustive directory trees or full module/component/route inventories.
- Restated entity fields, enum members, or `I*Service` contract shapes — those are
  authoritative in `__FORGE_SCOPE__/core`. Architecture docs **link to it**; they never
  restate its shapes, because the executable contract in code is the truth, and prose
  describing it can silently go stale while the code moves on.
- Framework-specific organizing conventions (module layout, component-tier conventions,
  directory tables) — those belong in each package's own `STANDARDS.md`, not in the
  shared architecture docs.

The test for what belongs here: is this a boundary/contract/decision, or an inventory of
the code? A sharper follow-up test for domain vs. framework: would a *different* package
need to know this to integrate correctly? If not, it is local structure and belongs in
that package's own docs.

## Consequences

### Positive

- Architecture docs stay stable and rarely need edits when code moves, so they drift far
  less.
- A clear, reusable test for what belongs here.
- Less duplication between the shared docs and each package's own documentation.

### Negative

- Readers who want the exact shape of an entity or contract must open
  `__FORGE_SCOPE__/core` rather than reading it here.
- The boundary is a judgment call at the margins and needs occasional review as the
  project grows.
