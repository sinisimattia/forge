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
- **TSDoc is definition-of-done.** Every exported `class`/`interface`/`type`/`enum` and every contract method carries TSDoc.
- **Money as integer cents; Dates are UTC `Date` in entities, ISO-8601 strings on the wire.**

## File layout — per-domain folders

`libs/core/src/` is organized **per domain** (e.g. `articles/`), plus one cross-domain
`shared/` folder. Each domain folder has exactly six subfolders:

| Folder | Contents | Never contains |
|---|---|---|
| `entities/` | Domain entity classes (e.g. `Article.ts`, `Comment.ts`) | contracts, enums, errors |
| `contracts/` | `I*Service` interfaces (e.g. `IArticleService.ts`) | implementations |
| `enums/` | Enums (e.g. `Visibility.ts`, `CommentStatus.ts`) | — |
| `errors/` | Domain error classes, each `extends DomainError` (e.g. `ArticleTitleRequiredError.ts`) | the base `DomainError` itself (that lives in `shared/errors/`) |
| `types/` | **Pure** interfaces/type-aliases only: JSON wire shapes, value types, create-input/result types (e.g. `ArticleJSON.ts`, `CreateArticleInput.ts`) | enums, classes, errors — anything with runtime behavior |
| `testing/` | Exported conformance suites + fixtures (e.g. `runIArticleServiceContract.ts`, `article-fixtures.ts`) | — |

`shared/` holds cross-domain primitives, split the same way where applicable:
- `shared/errors/` — the base `DomainError` class that all domain errors extend.
- `shared/testing/` — generic, runner-agnostic conformance-harness types (e.g. `ConformanceExpect`, `ConformanceRunner`).
- `shared/types/` — generic, cross-domain pure types (e.g. `Brand`).

**One file per symbol.** Every exported class/interface/type/enum lives in its own file,
named exactly after the symbol in PascalCase (e.g. `Article.ts`, `IArticleService.ts`,
`Visibility.ts`, `CreateArticleInput.ts`, `ArticleTitleRequiredError.ts`). Every folder has an
`index.ts` barrel re-exporting its files.

**Subpath exports only.** Consumers import via per-domain, per-folder subpaths —
`__FORGE_SCOPE__/core/<domain>/entities`, `/<domain>/contracts`, `/<domain>/enums`, `/<domain>/errors`,
`/<domain>/types`, `/<domain>/testing`, `/shared/errors`, `/shared/testing`, `/shared/types` —
declared in `package.json` `exports`. There is no bare `__FORGE_SCOPE__/core` export.

**Errors throw specific subclasses.** A domain invariant violation throws the specific
`DomainError` subclass from that domain's `errors/` folder — **never** the base `DomainError`
directly. The base class exists so callers can catch broadly (`catch (e) { if (e instanceof DomainError) }`)
or narrowly (a specific subclass), not so code throws it directly.

**Tests live outside `src/`.** Core unit tests (entity invariants, `fromJSON`, contract
conformance-suite tests) live under `libs/core/tests/`, mirroring the `src/` domain
structure (e.g. `tests/articles/entities/Article.spec.ts`), and import the code under test via
its public `__FORGE_SCOPE__/core/*` subpath — never via relative paths into `src/`. Only the exported
`testing/` harnesses and fixtures (the published conformance suites themselves) live in `src/`.

## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| K1 | No framework or runtime imports — static, dynamic, or `require` | `npx nx run core:lint` reports `@typescript-eslint/no-restricted-imports` or `no-restricted-syntax` | blocking | STANDARDS.md — Framework purity |
| K2 | No transport vocabulary in prose, including camelCase/PascalCase compounds (URLs exempted, not whole lines) | `npm run purity -w libs/core` exits non-zero | blocking | STANDARDS.md — Framework purity |
| K3 | Service contracts are `I`-prefixed | `grep -rn "export interface [^I]" src/*/contracts/` | blocking | STANDARDS.md — I-prefix contracts |
| K4 | Contracts speak in entities, not DTOs | review `src/*/contracts/*.ts` for shapes that are neither an entity, a create-input type, nor a JSON wire shape | blocking | STANDARDS.md — Entities, not DTOs |
| K5 | TSDoc on every export | `grep -rnB1 "^export " src/ \| grep -v "\*/"` | blocking | STANDARDS.md — TSDoc is definition-of-done |
| K6 | One symbol per file, PascalCase filename | file basename matches the exported symbol | warning | STANDARDS.md — File layout |
