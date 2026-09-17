# Agent Playbook

This is the unified agent playbook shared by both the `backend` and `webapp` apps. The
roster, lifecycle, and trigger semantics are **identical in both apps**; only the
framework-specific behavior _inside_ the implementer, reviewer, and tester differs, and
that behavior is documented in each package. See
[ADR-0002](../adrs/0002-consolidated-agent-roster.md) for the rationale.

## Roster (9 roles)

| Role                                                           | Purpose                                                                                                                                                                                                                                                                                                                                       | Trigger                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **planner**                                                    | Produce the implementation plan for the task being implemented. Reads the relevant design docs / RFC / API spec / standards from the shared `docs/` folder, audits the existing code, and outputs a reviewable plan; sequences work **core-first** across `core → backend → webapp`.                                                          | Before starting any task that touches more than one file, or "plan feature X". The plan is reviewed before implementation begins.          |
| **core-implementer**                                           | Owns `libs/core` (`__FORGE_SCOPE__/core`): pure-TypeScript entities, `I*Service` contracts, and conformance suites, with TSDoc on every export. Enforces core purity (no framework imports) and entities-not-DTOs.                                                                                                                                      | For any `libs/core` implementation work; runs **before** the app implementers in the core-first flow.                                      |
| **implementer** (`backend-implementer` / `webapp-implementer`) | Write the code that satisfies the plan. Also generates the framework-specific companion artifacts — database migrations in the backend, component stories in the webapp.                                                                                                                                                                      | After a plan is approved, or directly for a scoped change.                                                                                 |
| **reviewer**                                                   | Run one multi-dimension standards/compliance check over the diff. Carries a terse executable checklist (grep/signal + severity) per dimension, each annotated with its authoritative source doc. Runs only the dimensions relevant to the changed files, including the `libs/core` purity/contract/TSDoc dimensions when a core file changed. | After any source change. Runs the dimensions that apply to the touched files (e.g. skip SEO checks if no SSR page changed).                |
| **core-tester**                                                | Writes Jest unit tests for `libs/core` entity invariants and `fromJSON` rehydration, and owns the runner-agnostic conformance suites that both apps drive against their `I*Service` implementations.                                                                                                                                          | When core entities/contracts change, or a conformance suite needs adding/updating; runs **before** the app testers in the core-first flow. |
| **tester** (`backend-tester` / `webapp-tester`)                | Write and run tests. Unit by default; end-to-end is a mode invoked on request or after a complete multi-page/flow implementation.                                                                                                                                                                                                             | After changes to logic-bearing files; e2e on request.                                                                                      |
| **documenter**                                                 | Owns the human-friendly **narrative** docs (READMEs, `docs/guides/`, `docs/architecture/`, `docs/concepts/`). Check-first, write-only-if-needed: gap-checks the narrative layer and updates only when a real gap exists, verifying any code example it writes. Never restates shapes/rules (links instead), never touches TSDoc/CHANGELOG.    | After the testers/reviewer pass and **before** the closer; also on explicit request ("write a guide for X").                               |
| **closer**                                                     | Wrap up the session: lint → test → CHANGELOG.                                                                                                                                                                                                                                                                                                 | "close the session", "commit and close", "wrap up", "mark as done".                                                                        |
| **pr**                                                         | Create or review a pull request. In _create_ mode it commits, pushes, and shows a structured PR description for approval. In _review_ mode it reads the diff fresh and judges independently, preserving an adversarial stance.                                                                                                                | "open a PR" / "create the PR" (create mode); "review PR #N" / "code review" (review mode). On request only.                                |

## Lifecycle

```
planner → core-implementer → [ implementer(s) ] → [ reviewer ‖ core-tester ‖ tester(s) ] → documenter → closer → pr
                ↑________________________ fix loop ________________________|
```

- Work is sequenced **core-first**: a domain's entities, `I*Service` contract, and
  conformance suite land in `libs/core` via `core-implementer` before the backend and
  webapp implementers build against that contract.
- After the implementer(s) write code, the **reviewer**, **core-tester**, and
  **tester(s)** run in parallel (`‖`); they are independent.
- Any failure or violation feeds the **fix loop** back to the relevant implementer,
  which addresses it and re-triggers review/test.
- Once the diff is clean, the **documenter** runs a check-first gap pass over the
  narrative docs (READMEs, guides, architecture, concepts) — updating them only when a
  real gap exists and staying silent otherwise — before the **closer** finalizes the
  session and **pr** opens or reviews the pull request on request.

## Notes

- **Same flow in both apps.** This replaces the previous divergence (backend ran a
  linear chain; webapp fired parallel validators). Both now converge on this single
  lifecycle, documented here once and referenced from each package's `CLAUDE.md`.
- **Framework-specific behavior lives in each package.** The roles are the same; what the
  implementer generates, which dimensions the reviewer checks, and how the tester runs
  are package-local concerns described in each package's agent prompts and `STANDARDS.md`.
- **The reviewer's checklists are derived from the standards docs, not copies of them.**
  Each checklist entry points at its authoritative source (a `standards/*.md` file, a
  package `STANDARDS.md`, or an ADR/RFC); on any conflict, the source doc wins.
- **The planner reads the latest reference docs before planning.** The shared `docs/`
  folder is read-only reference material at the top level of the monorepo; the docs win
  on conflict (see [ADR-0001](../adrs/0001-single-source-documentation.md)).
