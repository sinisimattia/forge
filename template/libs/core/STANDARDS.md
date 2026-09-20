# __FORGE_TITLE__ Core — Local Standards (framework-agnostic domain)

## Authoritative standards
| Topic | Home |
|-------|------|
| Naming, typing, TSDoc, money/dates | `docs/standards/*` |
| Entity/enum definitions | `docs/rfcs/` |
| Boundaries & the executable-contract role | `docs/architecture/`, ADR-0003, ADR-0004 |

If this file and a shared/ADR/RFC document disagree, the document wins.

## Rules specific to `libs/core`
- **Framework purity.** No imports of `typeorm`, `@nestjs/*`, `nuxt`, `vue`, `pinia`, or any framework/runtime-specific package. Pure TypeScript + `@types/node` only. This extends to comments/TSDoc: `libs/core` must never reference `apps/backend`, `apps/webapp`, their frameworks, their concrete class names, their guards/decorators, or their transport specifics (HTTP, cookies, JWT) — in prose, not just imports. The rule is one-directional: apps depend on and reference `__FORGE_SCOPE__/core` freely; core must be fully describable — its contracts, exclusions, and load-bearing parameters — without naming or knowing who consumes it. References to other `__FORGE_SCOPE__/core` symbols/contracts remain fine. The reviewer's core-purity dimension enforces this for prose, not just imports.
- **`verbatimModuleSyntax`.** Type-only imports/exports use `import type`/`export type` explicitly (enforced by `tsconfig.json`).
- **`I`-prefix contracts.** Service interfaces are `IArticleService`, `I*Service`.
- **Entities, not DTOs.** Contract methods speak in domain entities; narrow inputs with `Omit`/`Pick`. The only sanctioned non-entity shapes are per-create input types and the per-entity JSON wire shape + `fromJSON` reviver.
- **Exhaustive switches.** Every `switch` over an enum or a discriminated union ends in `default: return assertNever(value)` (`shared/policies`), so widening the union turns every site that does not handle the new member into a compile error rather than a silent fall-through. This is a compile-time guarantee only — see *`nx test core` does not type-check* below.
- **TSDoc is definition-of-done.** Every exported `class`/`interface`/`type`/`enum` and every contract method carries TSDoc.
- **A `{@link X}` to a symbol this file does not import renders as plain text, and that is accepted here.** It is uniform rather than accidental: every `<Thing>Props` and `<Thing>JSON` links back to `<Thing>`, in all four domains, and none of them can import it — the entity imports the props type, so the import that would make the link resolve is a cycle. Do not "fix" the subset that happens to be importable. Half-fixing it is the only way to end up with two precedents in a package whose domains are meant to be copied from one another, and a naming reference a reader can follow by eye is worth more than an import added for a hover.
- **Money as integer cents; Dates are UTC `Date` in entities, ISO-8601 strings on the wire.**

## File layout — per-domain folders

`libs/core/src/` is organized **per domain** (e.g. `articles/`), plus one cross-domain
`shared/` folder. Each domain folder has exactly seven subfolders:

| Folder | Contents | Never contains |
|---|---|---|
| `entities/` | Domain entity classes (e.g. `Article.ts`, `Comment.ts`) | contracts, enums, errors |
| `contracts/` | `I*Service` interfaces (e.g. `IArticleService.ts`) | implementations |
| `enums/` | Enums (e.g. `Visibility.ts`, `CommentStatus.ts`) | — |
| `errors/` | Domain error classes, each `extends DomainError` (e.g. `ArticleTitleRequiredError.ts`) | the base `DomainError` itself (that lives in `shared/errors/`) |
| `types/` | **Pure** interfaces/type-aliases only: JSON wire shapes, value types, create-input/result types (e.g. `ArticleJSON.ts`, `CreateArticleInput.ts`) | enums, classes, errors — anything with runtime behavior |
| `testing/` | Exported conformance suites + fixtures (e.g. `runIArticleServiceContract.ts`, `article-fixtures.ts`) | — |
| `policies/` | **Pure functions** over entities, enums and types — the only place in core a standalone function may live (e.g. `normalizeEmail.ts`, `assertNever.ts`, later `can.ts`) | classes, interfaces, state, anything with a dependency |

A domain rule that is not a method on an entity — because it spans entities, or because it must
be callable without constructing one — has nowhere else to live, and hiding it as a static
method on a class with no instances is worse.

`shared/` holds cross-domain primitives, split the same way where applicable:
- `shared/errors/` — the base `DomainError` class that all domain errors extend.
- `shared/testing/` — generic, runner-agnostic conformance-harness types (e.g. `ConformanceExpect`, `ConformanceRunner`).
- `shared/types/` — generic, cross-domain pure types (e.g. `Brand`).
- `shared/policies/` — generic, cross-domain pure functions (e.g. `normalizeEmail`, `assertNever`).

**One file per symbol.** Every exported class/interface/type/enum lives in its own file,
named exactly after the symbol in PascalCase (e.g. `Article.ts`, `IArticleService.ts`,
`Visibility.ts`, `CreateArticleInput.ts`, `ArticleTitleRequiredError.ts`). Every folder has an
`index.ts` barrel re-exporting its files.

**Subpath exports only.** Consumers import via per-domain, per-folder subpaths —
`__FORGE_SCOPE__/core/<domain>/entities`, `/<domain>/contracts`, `/<domain>/enums`, `/<domain>/errors`,
`/<domain>/types`, `/<domain>/testing`, `/<domain>/policies`, `/shared/errors`, `/shared/testing`,
`/shared/types`, `/shared/policies` — declared in `package.json` `exports`. There is no bare
`__FORGE_SCOPE__/core` export.

**Errors throw specific subclasses.** A domain invariant violation throws the specific
`DomainError` subclass from that domain's `errors/` folder — **never** the base `DomainError`
directly. The base class exists so callers can catch broadly (`catch (e) { if (e instanceof DomainError) }`)
or narrowly (a specific subclass), not so code throws it directly.

**Tests live outside `src/`.** Core unit tests (entity invariants, `fromJSON`, contract
conformance-suite tests) live under `libs/core/tests/`, mirroring the `src/` domain
structure (e.g. `tests/articles/entities/Article.spec.ts`), and import the code under test via
its public `__FORGE_SCOPE__/core/*` subpath — never via relative paths into `src/`. Only the exported
`testing/` harnesses and fixtures (the published conformance suites themselves) live in `src/`.

**`nx test core` does not type-check.** `tsconfig.base.json` sets `isolatedModules: true`, which
puts ts-jest into transpile-only mode: a spec containing a blatant type error — a `@ts-expect-error`
that no longer expects anything, a `const count: number = 'not a number'` — compiles away and the
suite passes green. Type-level assertions are enforced **only** by the `typecheck` target
(`tsc --noEmit`), which CI runs as a mandatory sibling of `test`. A green local `npm test` is
evidence about runtime behaviour and about nothing else; run `nx typecheck core` before trusting
any type-level guarantee, including the exhaustiveness rule above.

## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| K1 | No framework or runtime imports — static, dynamic, or `require` | `npx nx run core:lint` reports `@typescript-eslint/no-restricted-imports` or `no-restricted-syntax` | blocking | STANDARDS.md — Framework purity |
| K2 | No transport vocabulary in prose, including camelCase/PascalCase compounds (URLs exempted, not whole lines) | `npm run purity -w libs/core` exits non-zero | blocking | STANDARDS.md — Framework purity |
| K3 | Service contracts are `I`-prefixed | `grep -rn "export interface [^I]" src/*/contracts/` | blocking | STANDARDS.md — I-prefix contracts |
| K4 | Contracts speak in entities, not DTOs | review `src/*/contracts/*.ts` for shapes that are neither an entity, a create-input type, nor a JSON wire shape | blocking | STANDARDS.md — Entities, not DTOs |
| K5 | TSDoc on every export | `grep -rnB1 "^export " src/` — read the `-B1` context line of each hit: one that is not `*/` (the close of a TSDoc block) is a violation. Barrel re-exports in `index.ts` are not. **No pipe on purpose** — a shell pipe cannot survive a markdown table cell (see the note below the table) | blocking | STANDARDS.md — TSDoc is definition-of-done |
| K6 | One symbol per file, PascalCase filename | file basename matches the exported symbol | warning | STANDARDS.md — File layout |
| K7 | A rejection reason is modelled for the audit record, never for an untrusted caller | **read and judge** — open `src/*/contracts/*.ts` and `src/*/types/*Outcome.ts`: a rejection reason may be modelled, recorded and audited, but must not appear as a field of a JSON wire shape returned on an authentication path. No grep decides this; the reviewer reads the file. | blocking | ADR-0005 — a rejection reason is recorded, never returned |
| K8 | Every `switch` over an enum or a discriminated union ends in `assertNever` | `grep -rnE "switch *\(" src/` locates every switch, with or without the space before `(`, then **read each hit**: one whose `default` is not `return assertNever(...)` is a violation. The grep is a locator, not a verdict. | blocking | STANDARDS.md — Exhaustive switches |

**No `Signal` in this table contains a pipe.** A markdown table cell cannot carry a bare `|`,
so a pipe has to ship escaped as `\|` — and that escape is read two different ways: rendered it
is a pipe, read raw (which is how an agent reads this file) it is a literal backslash-pipe. Under
`grep -E` a raw `\|` is a literal pipe character and matches nothing; as a *shell* pipe it
escapes into a literal `|` argument and the command does not pipe at all. Both failures are
silent. Write alternation as repeated `-e` patterns, which are correct under either reading,
and state filtering as a criterion the reviewer applies to the hits.

K2 is a text check over prose: it catches accidental transport vocabulary, including camelCase,
PascalCase and snake_case/kebab-case compounds, with real `http(s)://` links exempted. It does not
defend against deliberate evasion — a word split across two lines, or unicode look-alikes, will
pass. Nor does it catch a forbidden word that happens to sit inside a genuine `https://` URL's
path or query string (e.g. `.../docs/nestjs-migration-guide`) — the whole link span is stripped
before matching, as collateral, so a real occurrence of the word is stripped along with it. It is
a guard against mistakes, not an adversary.
