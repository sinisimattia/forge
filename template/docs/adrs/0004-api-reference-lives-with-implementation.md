# ADR-0004: API Reference Lives With the Implementation

- **Status:** Accepted
- **Date:** 2026-09-17
- **Relates to:** [ADR-0001](0001-single-source-documentation.md), [ADR-0003](0003-architecture-docs-describe-boundaries.md)

## Context

An API reference maintained by hand in a shared, central docs location — every method,
path, request/response body, and status code — tends to drift from the code that actually
implements it. It also contradicts describing boundaries rather than inventories
(ADR-0003): a method-by-method endpoint table is exactly an inventory. And it is the
wrong home for the concrete truth: the endpoints are produced by one package's
implementation, and a hand-copied spec living elsewhere drifts the moment that package
changes without the docs following — exactly the multi-copy drift single-source
documentation (ADR-0001) exists to prevent.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

**The concrete API reference lives with the implementation**, in the package that serves
it (e.g. `apps/backend/docs/api/`). The shared `docs/api/` directory keeps only
**cross-cutting, conceptual** material:

- What the API is and its role as the contract between producer and consumer packages.
- The authentication model at a conceptual level.
- Cross-cutting conventions named conceptually (error envelope shape, pagination,
  versioning, rate limiting) — with their concrete shapes documented beside the
  implementing code.
- A pointer to the authoritative, concrete endpoint reference in the implementing
  package.

The concrete reference (paths, methods, request/response bodies, status codes) is
hand-written markdown next to the code, ideally generated from the code itself (e.g. via
OpenAPI) once that tooling exists, so the code becomes the single source of truth rather
than a hand-maintained copy of it.

## Consequences

### Positive

- The shared `docs/api/` directory honors ADR-0003 — it describes the boundary, not an
  inventory.
- The concrete spec sits next to the code that implements it, so it drifts far less and
  can eventually be generated from it.
- One canonical home per concern: concepts in the shared docs, concrete reference beside
  the code.

### Negative

- A consumer package does not hold the concrete reference in its own tree;
  understanding "the API" means reading the shared conceptual doc plus the concrete
  reference in the producing package.
- Until an OpenAPI-style generation step lands, the concrete reference is still
  hand-maintained, though now co-located with the code it documents.
