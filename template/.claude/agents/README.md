# __FORGE_TITLE__ — Agent Roster

The single, consolidated lifecycle roster for the __FORGE_TITLE__ NX monorepo. All agents live
in this one root `.claude/agents/` directory and span the workspace's packages
(`libs/core`, `apps/backend`, `apps/webapp`) plus `docs/` (see
[ADR-0002](../../docs/adrs/0002-consolidated-agent-roster.md)).

The shared lifecycle, trigger semantics, and "runs automatically after X" rules are
defined **once** in the shared playbook, **`docs/standards/agent-playbook.md`**;
per-role behavior lives in this directory. Agents are thin: they carry role +
procedure + pointers, **not** restated rules. The rules live in:

- `libs/core/STANDARDS.md` — core-local (framework purity, `I`-prefix contracts, entities-not-DTOs).
- `apps/backend/STANDARDS.md` — backend-local (NestJS / TypeORM).
- `apps/webapp/STANDARDS.md` — webapp-local (Nuxt / Vue / Atomic Design).
- `docs/standards/*.md` — shared, framework-agnostic rules + the agent playbook.
- ADRs / RFCs — authoritative for their topics.

**Docs win on any conflict** ([ADR-0001](../../docs/adrs/0001-single-source-documentation.md)).

## Roster

Stack-agnostic roles are single monorepo-aware agents (a feature or PR now spans
packages); stack-specific roles get a per-package variant. The specialization
mechanism is the same for every role — a thin agent prompt points at that package's
`STANDARDS.md` plus the shared `agent-playbook.md`.

| Agent                 | Model  | Role / when to launch                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planner`             | Sonnet | Single, monorepo-aware. Produces the implementation plan from the relevant RFCs; sequences work **core-first** across `core → backend → webapp`. Deep-reads the relevant docs and audits existing code. Launch before a non-trivial feature.                                                                              |
| `core-implementer`    | Sonnet | Owns `libs/core` (`__FORGE_SCOPE__/core`): pure-TypeScript entities, `I*Service` contracts, conformance suites, TSDoc on every export. Enforces core purity and entities-not-DTOs. Launch for any `libs/core` implementation.                                                                                                        |
| `backend-implementer` | Sonnet | NestJS implementation; also generates/reviews TypeORM migrations after entity changes. Launch after a plan is approved, or for a direct backend code-authoring request.                                                                                                                                                    |
| `webapp-implementer`  | Sonnet | Nuxt/Vue/TS implementation; also creates/updates the component's `.stories.ts`. Launch after a plan is approved, or for a direct webapp code-authoring request.                                                                                                                                                            |
| `core-tester`         | Sonnet | Jest unit tests for `libs/core` entity invariants and `fromJSON` rehydration; owns the runner-agnostic conformance suites both apps drive against their `I*Service` implementations. Launch when core entities/contracts change.                                                                                           |
| `backend-tester`      | Sonnet | Jest unit tests by default, e2e as a mode; writes, evaluates, and fixes tests. Runs automatically after backend source changes.                                                                                                                                                                                            |
| `webapp-tester`       | Sonnet | Vitest unit tests by default, Playwright e2e as a mode. Runs automatically after `composables/`/`fetchers/`/`stores/` changes; on request for components; e2e on request or after a multi-page flow.                                                                                                                       |
| `reviewer`            | Sonnet | Single, monorepo-aware. One code-vs-docs / standards-compliance check over the diff — **discovers its compliance dimensions from each touched package's own `STANDARDS.md`** — and emits one JSON verdict per diff. Runs only the rows relevant to the changed files; can run in the background.                          |
| `documenter`          | Sonnet | Single, monorepo-aware. Owns the human-friendly narrative layer (READMEs, `docs/guides/`, `docs/architecture/`, `docs/concepts/`). **Check-first, write-only-if-needed**: gap-checks before `closer` and stays silent when docs are current; verifies any code example it writes. Also on request ("write a guide for X"). |
| `closer`              | Sonnet | Single, NX-aware. Close a session: `nx affected` → lint → test → CHANGELOG (where a package keeps one) across the touched packages. Launch on "wrap up", "done", "update the changelog".                                                                                                                                                               |
| `pr`                  | Sonnet | Single; a PR can span packages. Two modes: **create** (structured description + `gh pr create`) / **review** (reads the diff fresh, independent verdict, same dimension-discovery as `reviewer`). Launch on explicit request only ("open a PR", "review PR #N").                                                          |

## Task flow (core-first)

```
planner → core-implementer → [ backend-implementer ‖ webapp-implementer ]
        → [ *-tester ‖ reviewer ] → documenter → closer → pr
              ↑________________ fix loop ________________|
```

- Work is sequenced **core-first**: a domain's entities, `I*Service` contract, and
  conformance suite land in `libs/core` via `core-implementer` before the backend and
  webapp implementers build against that contract.
- After the implementer(s) write code, `reviewer` and the relevant `*-tester`(s) run in
  parallel — they are independent. Any failure or violation feeds the **fix loop** back to
  the relevant implementer, which addresses it and re-triggers review/test.
- `documenter` runs a check-first gap pass on the narrative docs before `closer`; it
  stays silent (no changes) when they're already current.
- `closer` scopes lint/test/CHANGELOG to `nx affected` packages; a project has no changelogs until its first release.
- `pr` is launched only on explicit user instruction.

## The reviewer

`reviewer` is a single agent that runs `git diff`, maps each changed file to the package
that owns it (longest path prefix among `libs/core`, `apps/backend`, `apps/webapp`), and
emits one JSON verdict. Dimensions are discovered from each package's `STANDARDS.md`
(`## Review dimensions`) — this prompt hardcodes none of them, so a package can add,
change, or remove a dimension without ever editing this directory.

Each dimension row is a terse executable checklist (an ID, a check, a grep/signal, a
severity, and the source doc it derives from); **the docs win on any conflict.** The
reviewer's persistent memory lives in `.claude/agent-memory/reviewer/`.
