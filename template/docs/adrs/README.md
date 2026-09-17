# ADRs (Architecture Decision Records)

This section captures the key technical decisions made during the development of
__FORGE_TITLE__, along with their context and consequences.

## Process

1. Copy [0000-template.md](0000-template.md) with the next available number (e.g.,
   `0005-my-decision.md`).
2. Fill in the context, decision, and consequences.
3. Set the status to **Accepted**.
4. Commit the ADR alongside the code change it documents.

## Statuses

| Status | Meaning |
|--------|---------|
| Proposed | Decision is under consideration |
| Accepted | Decision has been adopted |
| Deprecated | Decision is no longer relevant |
| Superseded | Decision has been replaced by a newer ADR |

## Index

| Number | Title | Status |
|--------|-------|--------|
| [0001](0001-single-source-documentation.md) | Single-Source Documentation | Accepted |
| [0002](0002-consolidated-agent-roster.md) | Consolidated Agent Roster | Accepted |
| [0003](0003-architecture-docs-describe-boundaries.md) | Architecture Docs Describe Boundaries | Accepted |
| [0004](0004-api-reference-lives-with-implementation.md) | API Reference Lives With the Implementation | Accepted |

ADRs 0001–0004 are Forge template defaults — inherited from the template, not decisions
this project made for itself. Supersede any of them with a new, higher-numbered ADR if
this project needs something different; do not edit them in place.
