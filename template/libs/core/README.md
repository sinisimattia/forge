# __FORGE_SCOPE__/core

The framework-agnostic domain library shared across the __FORGE_TITLE__ monorepo. Every consuming
app depends on it and implements its service contracts, so they provably speak the same language.
(The dependency is one-directional: consumers depend on `__FORGE_SCOPE__/core`;
`__FORGE_SCOPE__/core` never depends on or references a consumer.)

## Why this exists

The domain shape (what an entity is, what a given operation does) tends to live once per
consumer — duplicated and free to drift. `__FORGE_SCOPE__/core` makes the domain the **single,
executable source of truth**: one set of entities, one `I*Service` interface per domain, and one
runner-agnostic conformance suite. Each consumer implements the same contract for its own
runtime — one against real persistence, another over a remote transport — and every implementation
is held to that _same_ behavioral suite. The TypeScript compiler (`implements IArticleService`) and
the shared tests — not convention or code review — keep them identical. See
[ADR-0003](../../docs/adrs/0003-architecture-docs-describe-boundaries.md) and
[ADR-0004](../../docs/adrs/0004-api-reference-lives-with-implementation.md).

## What's inside

This skeleton ships the cross-domain `shared/` folder, the `users/` domain — the first real
domain, and the shape every later one copies — the `identities/` domain, which models the
ways a user can prove who they are as rows rather than columns on a user
([ADR-0005](../../docs/adrs/0005-identity-is-separate-from-user.md)), and the `auth/` domain,
which models being signed in as a `Session` and the result of an attempt to sign in as a
discriminated `AuthenticationOutcome` — never a boolean and never a credential, so that adding
a way for an attempt to end is a compile error at every consumer rather than a silent
fall-through, and the `audit/` domain, whose contract offers `record` and `query` and nothing
else — an interface that cannot express a change is one no caller can be talked into making,
and the other half of that guarantee is a privilege on the table rather than anything in
TypeScript. Its entry carries an explicit, nullable `organizationId` before any organization
exists, because this is the one table the application is not permitted to backfill
([ADR-0007](../../docs/adrs/0007-tenancy-is-explicit-never-ambient.md)). Each domain gets its own
folder under `src/` with up to seven subfolders — `entities/`, `contracts/`, `enums/`, `errors/`,
`types/`, `testing/`, `policies/` — one file per exported symbol, named exactly after the symbol.
A domain that has no rule needing a standalone function simply has no `policies/` folder.

- **`__FORGE_SCOPE__/core/shared/errors`** — the base `DomainError` class every domain error
  extends. Callers catch broadly (`instanceof DomainError`) or narrowly (a specific subclass); it
  is never thrown directly.
- **`__FORGE_SCOPE__/core/shared/testing`** — generic, runner-agnostic conformance-harness types:
  `ConformanceExpect` (the assertion surface a suite is driven through) and `ConformanceRunner`
  (the `describe`/`it`/`expect` primitives a suite needs from its host runner).
- **`__FORGE_SCOPE__/core/shared/types`** — cross-domain pure types, e.g. `Brand<T, B>` for nominal
  typing of primitives.

Each domain adds:

- **`__FORGE_SCOPE__/core/<domain>/entities`** — pure domain entity classes. Entities own their
  invariants and provide a `fromJSON` reviver (JSON has no `Date`/class instances).
- **`__FORGE_SCOPE__/core/<domain>/contracts`** — `I*Service` interfaces that speak in entities.
- **`__FORGE_SCOPE__/core/<domain>/enums`** — domain enums.
- **`__FORGE_SCOPE__/core/<domain>/errors`** — domain error classes, each `extends DomainError`.
  Invariant violations throw the specific subclass, never `DomainError` directly.
- **`__FORGE_SCOPE__/core/<domain>/types`** — pure interfaces/type-aliases only: JSON wire shapes,
  value types, and create-input/result types. No enums, classes, or errors live here.
- **`__FORGE_SCOPE__/core/<domain>/testing`** — runner-agnostic conformance suites that every
  consumer drives with its own test runner, plus fixtures.
- **`__FORGE_SCOPE__/core/<domain>/policies`** — pure functions over that domain's entities, enums
  and types: the domain rules that are not a method on an entity because they span entities or must
  be callable without constructing one.

There is no bare `__FORGE_SCOPE__/core` export — everything is imported via a per-domain,
per-folder subpath declared in `package.json` `exports`.

Core unit tests (entity invariants, `fromJSON`, contract-conformance tests) live under
`libs/core/tests/`, mirroring the `src/` domain structure — **not** under `src/`. They import the
code under test via its public `__FORGE_SCOPE__/core/*` subpath.

## Invariants this package upholds

- Framework purity (no runtime-framework imports) — extends to comments/TSDoc, which never
  reference a consuming app, its framework, or its concrete class names; the apps may reference
  `__FORGE_SCOPE__/core`, never the reverse.
- `I`-prefixed contracts; entities-not-DTOs (inputs narrowed with `Omit`/`Pick`; the only sanctioned
  extra shapes are create-input types and the JSON wire shape + `fromJSON`).
- Domain invariant violations throw a specific `DomainError` subclass, never the base class directly.
- One file per symbol, filename exactly matching the symbol name (PascalCase); every folder has an
  `index.ts` barrel.
- TSDoc on every export; money as integer cents; UTC dates.

## Conformance tests, by example

Each contract ships with a **conformance suite** — a runner-agnostic function (e.g.
`runIArticleServiceContract`, exported from `__FORGE_SCOPE__/core/articles/testing`) that encodes
the behavior every implementation of that contract must exhibit. The suite takes your test
runner's `describe`/`it`/`expect` plus a `makeService` factory and calls them itself. It imports
**no** test runner, so any runner can drive it; the only assertion capabilities it leans on are
the tiny `ConformanceExpect` surface (`__FORGE_SCOPE__/core/shared/testing`).

A consumer implements the contract for its own runtime and drives the suite from its own test file:

```ts
import { describe, it, expect } from "<your test runner>";
import { runIArticleServiceContract } from "__FORGE_SCOPE__/core/articles/testing";
import type { IArticleService } from "__FORGE_SCOPE__/core/articles/contracts";
import type {
  CreateArticleInput,
  CreateArticleResult,
} from "__FORGE_SCOPE__/core/articles/types";
import { Article } from "__FORGE_SCOPE__/core/articles/entities";

// A minimal implementation. `implements IArticleService` makes the compiler enforce the
// contract's shape; the conformance suite then enforces its behavior.
class InMemoryArticleService implements IArticleService {
  private readonly store = new Map<string, Article>();

  async findById(id: string): Promise<Article | null> {
    return this.store.get(id) ?? null;
  }

  async findByIdOrFail(id: string): Promise<Article> {
    const found = await this.findById(id);
    if (!found) throw new Error("not found");
    return found;
  }

  async create(
    authorId: string,
    input: CreateArticleInput,
  ): Promise<CreateArticleResult> {
    // ...construct a real Article from `input`, store it, and return { article }.
  }
}

// Drive the shared suite. `makeService` must return a fresh, empty instance on every call.
runIArticleServiceContract({
  describe,
  it,
  expect,
  makeService: () => new InMemoryArticleService(),
});
```

The same suite runs unchanged against every implementation of `IArticleService`, whatever its
runtime. Two lines of defense keep those implementations identical — `implements IArticleService`
at compile time and this suite at runtime — rather than convention or code review.

An implementation that crosses a serialization boundary receives its data as plain JSON, with no
`Date`s or class instances. Rehydrate it through the entity's `fromJSON` reviver (e.g.
`Article.fromJSON`) before returning — the suite asserts real instances
(`expect(...).toBeInstanceOf(Article)`), so returning bare JSON fails it.

## How to add a domain

1. Create `src/<domain>/{entities,contracts,enums,errors,types,testing}/` (plus `policies/` if the
   domain needs one), one file per symbol
   (filename = symbol name, e.g. `Article.ts`, `IArticleService.ts`, `Visibility.ts`,
   `ArticleTitleRequiredError.ts`, `CreateArticleInput.ts`, `runIArticleServiceContract.ts`), plus
   an `index.ts` barrel per folder.
2. Entities under `entities/` own their invariants, throw specific `errors/` subclasses (extending
   `DomainError` from `shared/errors/`), and provide a `<Name>JSON` wire type (in `types/`) +
   `fromJSON` static reviver.
3. Add the `I<Name>Service` contract under `contracts/`, speaking in entities, narrowing inputs
   with `Omit`/`Pick`, plus any create-input/result types under `types/`.
4. Add a `run<IName>Contract` suite + fixtures under `testing/`.
5. Declare the new subpaths (`./<domain>/entities`, `/contracts`, `/enums`, `/errors`, `/types`,
   `/testing`, and `/policies` if present) in `libs/core/package.json` `exports` — and **nowhere else**.
   Every other
   resolution point (`libs/core/tsconfig.json` `paths`, `libs/core/jest.config.js`
   `moduleNameMapper`, `apps/backend/tsconfig.json` `paths`, `apps/backend/jest.config.ts`
   `moduleNameMapper`, `apps/webapp/vitest.config.ts` `resolve.alias`) is a `__FORGE_SCOPE__/core/*`
   wildcard that picks up a new subpath with no edit. Those five resolve to **source**, so a
   wildcard there cannot hide anything. `exports` is hand-enumerated on purpose: it is the only
   map that resolves into `dist/`, and enumerating it makes a subpath you forgot to declare fail
   loudly (`Missing "./<domain>/<folder>" specifier in "__FORGE_SCOPE__/core" package`) instead of
   silently serving stale compiled output. Then `rm -rf dist && npx nx build core
   --skip-nx-cache` (NX can otherwise serve a stale `dist`).

   "Resolve to source" means at **compile and test time**. At **runtime** a consuming app
   still loads core's `dist`: a path mapping is not a rewrite, so compiled backend code keeps
   its bare `__FORGE_SCOPE__/core/...` specifier and Node follows the workspace symlink into
   `libs/core/dist` through `exports`. That is why the backend's production image copies
   `libs/core/dist`, and why a subpath missing from `exports` breaks the container even
   though every gate passed.
6. Add unit tests under `libs/core/tests/<domain>/...` (mirroring the `src/` layout), importing the
   code under test via its `__FORGE_SCOPE__/core/<domain>/*` subpath.
7. In each consuming app, implement the contract and drive the conformance suite:
   - Implement `I<Name>Service` for that app's runtime. A persistence-backed implementation maps
     between its storage entities and the domain entities (a hybrid pattern: contract methods
     return domain entities; keep storage-typed helpers for internal callers). A transport-backed
     implementation calls the remote API and rehydrates responses via `fromJSON`.
   - No module-resolution wiring is needed in the consuming app — its
     `__FORGE_SCOPE__/core/*` mapping is already a wildcard (see step 5). Re-export the domain's
     enums from wherever that app centralizes its enum definitions.
   - Drive `run<IName>Contract` from the app's own test runner — see _Conformance tests, by
     example_ above for the shape. A transport-backed implementation's stub must faithfully
     reproduce the **real** API behavior (status codes, response shapes) — verify against the
     actual server, don't assume.
