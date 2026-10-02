# ADR-0003: Extraction Is Copy-Out Only — Voku Is Read-Only, Forever

- **Status:** Accepted
- **Date:** 2026-09-17

## Context

`~/Progetti/Voku` is the only source `template/` was ever built from — its consolidated
agent roster, single-source standards docs, `libs/core` pattern, containerized dev
environment, and — as a starting point only, never as the destination — its auth
model. Its guest-authentication and guest-token paths and its source-domain-scoped roles
were dropped on the way out, and the identity, tenancy, authorization and audit model
`template/` ships is new work rather than anything copied. Every task in this project's
build-out ran against a constraint that Voku must never
be modified, and every task closed by checking `git -C ~/Progetti/Voku status --porcelain`
was empty and `HEAD` was still the pinned commit (`fdfdbde`) the extraction started from.
That check was run, and held, through every commit in this history — including this one.

Copying code out of a real, working, domain-specific monorepo carries an obvious risk: a
literal source-project name, a domain type (`Event`, `Payment`, `Ticket`, `RSVP`), or a
populated secret leaking into what is supposed to be a generic template. `npm run
sanitize` (`tools/sanitize.mjs`) exists specifically to catch that mechanically — it scans
`template/` and `tools/` for the source project's name, source-domain identifiers and type
names, Stripe-style key prefixes, and populated `KEY: value`/`KEY=value` secrets, and it is
run before the first content commit and in CI, not just as an aspirational test.

## Decision

Voku is read-only, permanently, not just during the initial extraction. `template/` is
produced by copying explicit files out of Voku, once, by allowlist — never `cp -r` of a
whole package — and generalizing them. `npm run sanitize` gates every commit that touches
`template/` or `tools/`. There is no code path anywhere in Forge that writes to Voku.

## Consequences

### Positive

- The one-directional guarantee is structural and checked, not just promised: every task
  in this build verified Voku's git status and `HEAD` before finishing, and `sanitize`
  turns "did we leak the source project" from a review judgment call into a deterministic,
  automated gate that runs before every relevant commit and in CI.
- Because extraction is copy-and-generalize rather than copy-and-reference, a generated
  project never depends on Voku existing, being reachable, or staying in any particular
  state — the template is fully self-contained the moment it is copied out.

### Negative

- **The template cannot track upstream Voku changes.** If Voku's standards docs evolve, its
  agent roster changes, or its `libs/core` conventions shift after this extraction, none of
  that reaches `template/` automatically. There is no sync, no submodule, no drift-detection
  tooling — `template/` is a snapshot of Voku as it stood at `fdfdbde` on 2026-09-17. This is
  deliberate: drift and update tooling is outside what Forge sets out to build. A
  `forge.json` receipt is written into every generated project precisely so that re-syncing
  *stays possible* for whoever wants it, and performing the re-sync is a deliberate, manual
  re-extraction pass against a newer Voku commit, not an automatic one.
