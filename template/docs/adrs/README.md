# ADRs (Architecture Decision Records)

This section captures the key technical decisions made during the development of
__FORGE_TITLE__, along with their context and consequences.

## Process

1. Copy [0000-template.md](0000-template.md) with the next available number (e.g.,
   `0011-my-decision.md`).
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
| [0005](0005-identity-is-separate-from-user.md) | Identity Is Separate From User | Accepted |
| [0006](0006-authorization-is-a-pure-function-in-core.md) | Authorization Is a Pure Function in Core | Accepted |
| [0007](0007-tenancy-is-explicit-never-ambient.md) | Tenancy Is Explicit, Never Ambient | Accepted |
| [0008](0008-ports-not-vendors.md) | Ports, Not Vendors | Accepted |
| [0009](0009-two-database-roles.md) | Two Database Roles | Accepted |
| [0010](0010-organization-invitations.md) | Organization Invitations Are Single-Use, Expiring, Hashed and Address-Checked | Accepted |
| [0011](0011-federated-identity-never-auto-links.md) | A Federated Address Links Nothing | Accepted |

ADRs 0001–0011 are Forge template defaults — inherited from the template, not decisions
this project made for itself. Supersede any of them with a new, higher-numbered ADR if
this project needs something different; do not edit them in place.
