# ADR-0005: Four Test Tiers, And Tests Written To Fail

- **Status:** Accepted
- **Date:** 2026-10-02

## Context

Forge's output is a whole working application, so "Forge's tests pass" has to mean something
much larger than "the generator's functions return the values they should". The generator can
be perfectly correct and still ship a template that does not install, does not compile, does
not boot, or boots and is insecure — and none of that is visible from a suite that only
exercises `tools/create/`.

There is a second problem underneath it. A suite that only ever runs against correct code is
not evidence that it would notice incorrect code. A gate can exit `0` because the thing it
guards is fine, because its rule file was deleted, or because it scanned nothing at all, and
from the outside those are indistinguishable. This repository has produced both shapes. The
Storybook job compiled zero story files for an entire phase and would have reported success
doing so, had the error that stopped it not happened to be fatal. The `coverage` gate was in
the generated project's own CI and in nothing Forge ran, so a coverage regression was red in
the generated repository and green here.

## Decision

### Four tiers, each proving something the one below it structurally cannot

**1. Unit — `npm test`** (`node --test 'tests/unit/**/*.test.mjs'`, declared in Forge's
`package.json`). Proves the substitution logic is right: argument parsing and its exclusivity
rules, token derivation, substitution in contents and in path segments, binary passthrough,
the unresolved-token failure, subset membership, never-overwrite, the sanitize rules'
per-line judgement, the Node-engine comparison. Node builtins only (ADR-0002), and it runs in
milliseconds. It cannot prove anything at all about the tree those functions copy.

**2. Generated project — `npm run test:integration`** (`tests/integration/`). Proves the
output builds and passes its own gates. It generates a real project into a temporary
directory, installs it with `npm ci` — never `npm install`, because `npm install` re-resolves
and quietly rewrites the lockfile and therefore succeeds against a lockfile no `package.json`
in the workspace matches, while every real consumer (both Dockerfiles, `dev:up`, Forge's
Storybook CI job) uses `npm ci` — and then runs the generated project's own `lint`,
`typecheck`, `test`, `build`, `coverage`, core `purity` and webapp `layers`. It also checks a
load-bearing file inventory, and pins the generated project's two hand-written gate lists
(its root `affected` script and its own `ci.yml`) against each other by parsing both. What it
cannot prove is that the application *runs*: nothing here starts the stack, opens a
connection to a database, or serves a request.

**3. Storybook — `npx nx run webapp:build-storybook`.** Proves the component library
compiles. `build-storybook` is a separate nx target that `nx run-many -t build` never
invokes, so a broken story file passes every other tier. This tier is a CI job of its own
(`storybook` in `.github/workflows/ci.yml`); nothing under `tests/` runs it, so running it by
hand means naming it. Its own caveat is recorded next to it and is worth repeating here:
`storybook build` exits `0` over an empty module graph, so a green tick is worth something
only while the `stories` glob in `.storybook/main.ts` still matches real files — which is
what `template/apps/webapp/app/test/storybook-config.spec.ts` asserts cheaply, inside the
generated project's own `test` target.

**4. Docker — `FORGE_E2E=1 npm run test:integration`** (`tests/integration/docker.test.mjs`,
which no-ops unless `FORGE_E2E` is `1`; the `docker` CI job sets it). Proves the stack boots
against a real Postgres and that the end-to-end walks complete through the real HTTP surface.
Everything this tier has caught is a defect that only exists once the images actually run —
migrations, the database role that cannot update the audit table, container wiring,
configuration that is only read at boot. No faster tier can see any of it.

### A discriminating test is written to fail against a plausible wrong implementation

That is the whole distinction, and it is a distinction of *direction*, not of strength. An
ordinary test is written forwards: here is the right implementation, assert what it does. A
discriminating test is written backwards: name the wrong implementation first — the guard
that was never registered globally, the gate whose rule was quietly removed, the
authorization check that answers from a cached grant, the endpoint that forgot its decorator
— and then write the assertion that tells it apart from the right one. A test that passes
against both is not evidence about either.

Three consequences follow, and all three are visible in
`tests/integration/generated-project.test.mjs`:

- **Where Forge can, it injects the fault and watches the gate fail**, rather than asserting
  that a clean run exits `0`. A clean run exits `0` whether or not the underlying rule still
  fires.
- **The injection goes into a file that was already there, never a probe file the test writes
  for itself.** A probe file proves the guard covers the directory the probe was written
  into; an injection into a real domain file proves it covers the tree. (An earlier version
  wrote its probe into the one directory both gates had been developed in — the least
  informative place either could have been checked.)
- **A failure has to be distinguished from a typo.** `assert.rejects` alone cannot tell "the
  rule fired" from "the binary is missing" or "the path was wrong"; the helper there returns
  the failing command's output so the caller can assert on the rule's own message. That is
  what makes an injection evidence rather than a coincidence.

The injections run against the generated copy in a temporary directory and restore the files
afterwards, so `template/` itself is never mutated by a test run.

### D1 through D16 are the named faults

They are a set of named faults, each paired with the observation that must catch it. Among
them: an unresolved token must abort generation; a framework import in `libs/core` must fail lint;
adopt mode over an existing `CLAUDE.md` must leave it byte-identical; a source-project trace
must fail `sanitize`; an undecorated endpoint must answer `401` without a token; a reused
refresh token must be rejected *and* revoke its family; a cross-tenant request must never
return data; a revoked grant must deny the very next request; writing the audit table as the
application role must be refused by the database; transport vocabulary in core's prose must
fail `purity`; the last owner of an organization must not be able to leave. That is a
sample, not the set — the D-numbers are greppable in the tree, which is where the full list
lives. The value of numbering them is that a change can be checked against a list somebody
has to deliberately shorten.

They are deliberately **not** all in one directory, and they stay where they are. A fault in
the generator is caught in Forge's own `tests/`; a fault in the platform is caught in the
suite that owns that behaviour; and the ones that needed a composed application world of
their own live in `template/apps/backend/src/__tests__/discriminating/`. A D-number is a
claim about a behaviour, and the test for it belongs next to that behaviour — collecting them
into one file would move every one of them away from the code it constrains, and leave the
code looking untested.

Most of them carry their label in a comment at the test and at the source it constrains, so
grepping the label finds both. D4 is the exception: adopt mode's never-overwrite is covered
in `tests/unit/subset.test.mjs` and `tests/integration/create.test.mjs`, which assert the
existing file's contents are unchanged and that it is reported as skipped, without using the
label.

### Two traps that a reasonable person walks into

**`coverage` is a separate nx target, and `libs/core` enforces 100%.** `npx nx run-many -t
test lint typecheck` passes while coverage fails, because nx runs the targets you name and no
others. `coverage` is declared on `core` alone (`template/libs/core/project.json`); it runs
`jest --coverage`, and `template/libs/core/jest.config.js` sets statements, branches,
functions and lines to 100 globally. The generated-project tier invokes it as a subtest of
its own, with `--skip-nx-cache`, precisely because no `-t test lint typecheck` run says
anything about it. `purity` and `layers` have the same shape: not in the `-t` list the other
subtests use, so each needs naming explicitly.

**`npm test` is the unit tier only — `FORGE_E2E=1 npm test` runs nothing extra.** This is the
sharper of the two, because it fails *silently upward*: `npm test`'s glob is
`tests/unit/**/*.test.mjs`, which does not match `tests/integration/docker.test.mjs`, so
prefixing the environment variable changes nothing whatsoever. The command then exits `0` in
seconds, looking exactly like a full run that passed. The slow tiers are `npm run
test:integration`; `FORGE_E2E=1 npm run test:integration` is what adds Docker on top, and
that is the form `.github/workflows/ci.yml`'s `docker` job uses. If a run that was supposed
to boot containers finished quickly, it did not boot containers.

## Consequences

### Positive

- Each tier has a reason to exist that is not "more tests": there is a defect class that only
  it can see, so dropping one is a decision about what stops being checked, not a scheduling
  choice.
- A green run is worth something, because the gates that matter most have been watched to go
  red. The two gates whose rules are easiest to break without noticing — core's lint ban and
  core's prose purity — are injected against on every integration run.
- The faults are named, so a reviewer can ask "which of these does this change weaken?" of a
  diff, instead of relying on noticing.

### Negative

- **The tiers are slow, deliberately.** The generated-project tier spends a real `npm ci` and
  a real Nuxt build; the docker tier builds images. They run on push as well as on pull
  request, which costs tens of minutes per push — accepted on the grounds that a gate which
  runs only on the path somebody can choose not to take is not a gate.
- A new gate can need adding in several places — the generated project's `affected` script,
  its `nx.json` target defaults, its own CI workflow, and the tier here that invokes it. The
  integration tier parses the first three and pins them against each other, which is a check,
  not a single source.
- Writing a discriminating test is slower than writing an ordinary one, because it requires
  naming a specific wrong implementation first. That cost is why the set is a named list
  rather than a universal policy.
- The Storybook tier lives only in CI, so a developer who runs every script in **Forge's**
  `package.json` still has not compiled a single story file. (A generated project is better
  off: `build-storybook` is in its root `affected` script.)
