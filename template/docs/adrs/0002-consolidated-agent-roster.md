# ADR-0002: Consolidated Agent Roster

- **Status:** Accepted
- **Date:** 2026-09-17
- **Depends on:** [ADR-0001](0001-single-source-documentation.md)

## Context

A project with more than one package — a shared core library plus one or more apps built
on it, say — tends to grow a separate agent roster per package: each package accumulates
its own planner, its own reviewer, its own set of narrow single-purpose validators,
because it is easier to copy an existing agent than to share one. The rosters diverge —
different lifecycles, a different number of roles, the same rule enforced by
differently-worded validators in each package — and every one of those validators
re-states the rules it enforces, often at length, duplicating what already lives in
`docs/standards/*`.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

There is **one agent roster**, defined once in the root `.claude/agents/`, and **one
lifecycle**, documented once in
[`docs/standards/agent-playbook.md`](../standards/agent-playbook.md). Every package uses
the same roles and the same flow, sequenced core-first
(`planner → core-implementer → [package implementer(s)] → [reviewer ‖ tester(s)] →
documenter → closer → pr`).

Framework-specific behavior — what an implementer generates, which dimensions the
reviewer checks, how a tester runs — lives *inside* each role, read from that package's
own local knowledge (its `STANDARDS.md`, its own prompt fragment), not in a forked copy of
the role itself. The roster and the lifecycle are identical everywhere; only the content
each role reads varies per package.

## Consequences

### Positive

- Far fewer agent files to maintain, and no per-topic specialist proliferation.
- One lifecycle and one set of trigger semantics across every package — packages never
  diverge in how work flows through them.
- Agents carry role + procedure + pointer instead of restated rules, so they never become
  a second copy of `docs/standards/*`.

### Negative

- A single, more general role (e.g. one reviewer) must select the right dimensions per
  diff, rather than a set of narrowly-scoped validators that each check exactly one thing.
- Collapsing specialists loses their self-contained, copy-pasteable rule explanations;
  contributors must follow the pointer into the standards docs to see the full rule.
