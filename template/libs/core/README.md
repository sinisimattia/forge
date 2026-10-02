# __FORGE_SCOPE__/core

The framework-agnostic domain library shared across the __FORGE_TITLE__ monorepo. Every consuming
app depends on it and implements its service contracts, so they provably speak the same language.
(The dependency is one-directional: consumers depend on `__FORGE_SCOPE__/core`;
`__FORGE_SCOPE__/core` never depends on or references a consumer.)

## Why this exists

The domain shape (what an entity is, what a given operation does) tends to live once per
consumer — duplicated and free to drift. `__FORGE_SCOPE__/core` makes the domain the **single,
executable source of truth**: one set of entities, `I*Service` interfaces, and
runner-agnostic conformance suites. Each consumer implements the same contract for its own
runtime — one against real persistence, another over a remote transport — and every implementation
is held to that _same_ behavioral suite. The TypeScript compiler (`implements IArticleService`) and
the shared tests — not convention or code review — keep them identical. See
[ADR-0003](../../docs/adrs/0003-architecture-docs-describe-boundaries.md) and
[ADR-0004](../../docs/adrs/0004-api-reference-lives-with-implementation.md).

## What's inside

Every folder under `src/` except `shared/` is a **domain**: a bounded vocabulary named in its own
words, with a contract other code speaks through, the types that contract moves, and a
conformance suite that holds every implementation to it. `ls src/` is the list of what
exists, and it is the only list this file will point you to — a prose index of the domains would
be true on the day it was written and wrong the day after. What follows is the reasoning behind
the shapes that are not obvious from the tree.

`users/` is the shape every later domain copies. `identities/` models the ways a user can
prove who they are as rows rather than columns on a user
([ADR-0005](../../docs/adrs/0005-identity-is-separate-from-user.md)). `auth/` models being
signed in as a `Session` and the result of an attempt to sign in as a discriminated
`AuthenticationOutcome` — never a boolean and never a credential, so that adding a way for an
attempt to end is a compile error at every consumer rather than a silent fall-through.
`audit/`'s contract offers `record` and `query` and nothing else — an interface that cannot
express a change is one no caller can be talked into making, and the other half of that
guarantee is a privilege on the table rather than anything in TypeScript. Its entry carries an
explicit, nullable `organizationId`, which is stated rather than inferred because this is the
one table the application is not permitted to backfill
([ADR-0007](../../docs/adrs/0007-tenancy-is-explicit-never-ambient.md)).

`organizations/` holds an `Organization`, a `Membership` that says which role a person holds
*in* one, and an `Invitation`, the one credential whose holder is by construction not yet a
member of the thing it admits them to
([ADR-0010](../../docs/adrs/0010-organization-invitations.md)). `authorization/` is
`can(principal, permission, resource?)` plus the per-record grants its third layer reads
([ADR-0006](../../docs/adrs/0006-authorization-is-a-pure-function-in-core.md)).
`authorization/` is a domain of its own rather than a member of `shared/` because it needs
`PlatformRole`, `UserId` and `OrgRole`, and a `shared/` folder that depends on a domain inverts
the direction every other domain relies on — and because a client imports this one by name to
decide what to render, so the subpath is part of its interface.

Each domain gets its own folder under `src/` drawn from `entities/`,
`contracts/`, `enums/`, `errors/`, `types/`, `testing/` and `policies/` — one file per exported
symbol, named exactly after the symbol. **A domain has only the subfolders it needs**, and the
shipped tree is the proof: `organizations/` has no `policies/` (no rule of its own needs a
standalone function), and `authorization/` has neither `entities/` nor `enums/` (its
`Permission` is a string union in `types/`, and what it reasons about belongs to other domains).
An empty folder is a shape a later reader is obliged to keep; there are none.

- **`__FORGE_SCOPE__/core/shared/errors`** — the base `DomainError` class every domain error
  extends. Callers catch broadly (`instanceof DomainError`) or narrowly (a specific subclass); it
  is never thrown directly.
- **`__FORGE_SCOPE__/core/shared/testing`** — generic, runner-agnostic conformance-harness types:
  `ConformanceExpect` (the assertion surface a suite is driven through) and `ConformanceRunner`
  (the `describe`/`it`/`expect` primitives a suite needs from its host runner).
- **`__FORGE_SCOPE__/core/shared/types`** — cross-domain pure types, e.g. `Brand<T, B>` for nominal
  typing of primitives, and `PaginatedResult<T>`, the one page shape every listing contract returns.
- **`__FORGE_SCOPE__/core/shared/policies`** — pure functions with **no domain dependency at all**:
  `assertNever` (the exhaustiveness forcing function every `switch` over a domain union ends with)
  and `normalizeEmail`. That absence of a domain dependency is the whole membership rule, and it is
  load-bearing in the other direction too: `can()` needs `PlatformRole` and `UserId`, so it lives in
  `authorization/policies`, **not** here — a `shared/` folder that depends on a domain inverts the
  direction every domain relies on.

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

### The default shape, and the departures the shipped tree actually holds

The default is one `I*Service` per domain and one suite per contract, and it is what a new domain
should start as. It is **not** an invariant — read the tree, not this sentence. The departures
that ship each have a stated reason, and each is a precedent a new domain may follow:

| Departure | Where | Why |
|---|---|---|
| **A domain holds two contracts** | `identities/` — `IIdentityService` and `IBreachedPasswordRegistry` | The second is a *port* to an external capability the domain has to name (ADR-0008), not a second service over the same data. |
| **A contract has no suite** | `IBreachedPasswordRegistry` | The shipped implementation answers `false` unconditionally, so there is nothing an assertion could distinguish. A suite here would be a test that exists to pass, which this package treats as worse than no suite. It is owed one the moment a real registry is bound. |
| **A contract has two suites — one shared, one server-only** (**DEC-1**, below) | Any contract with an assertion only the store-owning implementation can satisfy: it ships a `run*Contract` and a `run*SecurityContract` (`ls src/*/testing/` for the ones that do) | Some assertions only an implementation that *owns the store* can honestly satisfy. Tenant isolation is the clearest: an implementation reaching its data over the wire could satisfy a cross-tenant assertion only by refusing on its own account, which proves that it refuses and nothing else. Those assertions live in the security suite, driven by the owning implementation and by nothing else. **If a cross-tenant assertion looks like it belongs in the shared suite, it belongs in the security one.** |

#### DEC-1 — conformance is split by who can honestly satisfy an assertion

The two-suites row above has a name because the suites themselves cite it by name. The rule: an
assertion belongs in the shared `run*Contract` suite when **every** implementation of the
contract can demonstrate it through that contract's own public methods, and in the
server-only `run*SecurityContract` suite when only the implementation that **owns the store**
can. The deciding question is not how important the property is — it is whether an
implementation that reaches its data over a remote transport could show the property
honestly, or could only assert something it has no way to observe.

Both halves of the split cost something when they are got wrong, and in opposite directions.
An assertion placed in the shared suite that a remote implementation can satisfy only by
refusing on its own account proves that it refuses and nothing further; a stub written to
make such an assertion pass is a test that exists in order to pass, which this package treats
as worse than no test. An assertion held back from the shared suite that every implementation
could in fact demonstrate is coverage given away for nothing.

A security suite is therefore driven by the store-owning implementation and by no other, and
that asymmetry is deliberate rather than unfinished — it is not repaired by adding a second
driver that proves nothing.

One more shape is worth naming because it is not a departure and reads like one: `authorization/`
ships `can(principal, permission, resource?)` as a pure function under `policies/`, pinned by
ordinary unit tests rather than by a conformance suite. A suite is for a *contract with more than
one implementation*. A pure function has exactly one, everywhere, which is the point of it.

Each contract that has one ships its **conformance suite** as a runner-agnostic function (e.g.
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

1. Create `src/<domain>/{contracts,types,testing}/` — always — plus whichever of `entities/`,
   `enums/`, `errors/` and `policies/` the domain actually needs; see "What's inside" for
   shipped domains that have fewer — one file per symbol
   (filename = symbol name, e.g. `Article.ts`, `IArticleService.ts`, `Visibility.ts`,
   `ArticleTitleRequiredError.ts`, `CreateArticleInput.ts`, `runIArticleServiceContract.ts`), plus
   an `index.ts` barrel per folder.
2. Entities under `entities/` own their invariants, throw specific `errors/` subclasses (extending
   `DomainError` from `shared/errors/`), and provide a `<Name>JSON` wire type (in `types/`) +
   `fromJSON` static reviver.
3. Add the `I<Name>Service` contract under `contracts/`, speaking in entities, narrowing inputs
   with `Omit`/`Pick`, plus any create-input/result types under `types/`.
4. Add a `run<IName>Contract` suite + fixtures under `testing/`. If any assertion can be honestly
   satisfied only by the implementation that owns the store — tenant isolation is the standing
   example — put it in a second, server-only `run<IName>SecurityContract` rather than in the shared
   suite; see "The default shape" above for why that split exists and what it is worth.
5. Declare the new subpaths (`./<domain>/entities`, `/contracts`, `/enums`, `/errors`, `/types`,
   `/testing`, and `/policies` if present) in `libs/core/package.json` `exports` — and
   **nowhere else**. Every other resolution point (`libs/core/tsconfig.json` `paths`,
   `libs/core/jest.config.js` `moduleNameMapper`, `apps/backend/tsconfig.json` `paths`,
   `apps/backend/jest.config.ts` `moduleNameMapper`, `apps/webapp/vitest.config.ts`
   `resolve.alias`, `apps/webapp/.storybook/main.ts` `resolve.alias`) is a
   `__FORGE_SCOPE__/core/*` wildcard that picks up a new subpath with no
   edit. Those resolve to **source**, so a
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
