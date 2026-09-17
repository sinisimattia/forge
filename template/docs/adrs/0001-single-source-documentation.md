# ADR-0001: Single-Source Documentation

- **Status:** Accepted
- **Date:** 2026-09-17

## Context

Coding standards and shared conventions have a natural tendency to end up stated in
several places at once: a root `CLAUDE.md` restates a rule in full prose, each package's
own `STANDARDS.md` restates the same rule again, agent prompts under `.claude/agents/*.md`
each re-explain the rules they enforce, and the ADRs/RFCs hold the actual authoritative
decision underneath all of it. A single rule — "money is stored as integer cents", say —
ends up written out several times.

Once a rule exists in more than one place, the copies drift: one gets updated, the others
don't, and nothing catches the mismatch, because no build step checks prose against prose.
There must be one canonical home per rule, with everything else pointing to it instead of
restating it.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

Shared, cross-package rules live exactly once, in `docs/standards/*.md` — one file per
topic (naming, typing, i18n, testing, git, data-conventions, formatting, agent-playbook,
plus a `README` index). Every `CLAUDE.md`, every package `STANDARDS.md`, and every agent
prompt **links to** the relevant standards file instead of restating its content. Where a
rule already has an authoritative ADR or RFC, the standards file links to that document
rather than repeating it.

On any conflict between a `CLAUDE.md` / `STANDARDS.md` / agent prompt and
`docs/standards/*` — **the docs win**.

## Consequences

### Positive

- One canonical home per rule; everything else points to it, eliminating multi-copy
  drift.
- Agent prompts and package docs stay short — they carry a pointer, not a restatement.
- A new package inherits the shared rules by linking in, without re-authoring them.

### Negative

- Contributors must follow a pointer into `docs/standards/` to see the full rule, rather
  than finding it restated locally.
- Nothing structurally prevents a new contributor from restating a rule out of habit; the
  "docs win on conflict" clause only catches the drift once copies actually diverge and
  someone notices.
