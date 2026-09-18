# __FORGE_TITLE__ Backend — Local Standards

NestJS / TypeORM / PostgreSQL-specific rules for this package. Framework-agnostic
rules (naming, typing, i18n philosophy, money-as-cents, enums-from-source, git,
testing philosophy) are **not** restated here — they live in the shared docs.

## Authoritative standards

Read these first. **If this file and the shared docs disagree, the docs win.**

| Topic | Source |
|-------|--------|
| Naming (no abbreviations, descriptive) | `docs/standards/naming.md` |
| Typing (no `any`, named types, dedicated type files) | `docs/standards/typing.md` |
| i18n philosophy (no hardcoded user-facing text) | `docs/standards/i18n.md` |
| Testing philosophy | `docs/standards/testing.md` |
| Git conventions (commits, branches) | `docs/standards/git.md` |
| Money-as-cents, enums-from-source, UTC | `docs/standards/data-conventions.md` |
| Agent lifecycle / playbook | `docs/standards/agent-playbook.md` |
| Domain entities/enums, once a domain RFC exists | `docs/rfcs/*.md` |
| Standards index | `docs/standards/README.md` |

The shared docs live in the top-level `docs/` folder and are read-only reference — never edit them from within this package.

---

## Module structure

Every feature module follows this layout:

```
src/<module>/
├── <module>.module.ts
├── <module>.controller.ts
├── <module>.service.ts
├── interfaces/                     # module interfaces — <name>.interface.ts
├── types/                          # local type aliases — <name>.types.ts
├── dto/
│   ├── create-<entity>.dto.ts
│   └── update-<entity>.dto.ts
├── <entity>.entity.ts
├── __tests__/
│   ├── <module>.controller.spec.ts
│   └── <module>.service.spec.ts
└── <module>.repository.ts          # only if complex queries exist
```

- This skeleton ships only `health/` (a liveness probe with no business logic) plus
  `src/common/` (shared cross-cutting concerns). Feature modules — e.g. `articles`,
  `comments`, `tags` — are added the same way once a domain exists.
- **Shared utilities:** `src/common/` — filters, interceptors, pipes, types, i18n
  plumbing. Check there for an existing utility or type before creating a new one.
- Auth is not part of this skeleton. Once it is added, guards belong in an `auth`
  module (`src/auth/guards/`) — the idiomatic NestJS placement — not in
  `src/common/`.
- Per the typing standard, every exported `interface`/`type` lives in its own
  `<name>.interface.ts` / `<name>.types.ts` — module-internal under
  `src/<module>/{types,interfaces}/`, shared under `src/common/types/`.

## Services vs controllers

- **Business logic lives exclusively in services.** Controllers handle HTTP
  concerns only: parse input, call one service method, return the result. No
  `if` conditions, no calculations, no TypeORM queries in controllers. DTOs
  validate shape only.
- `readonly` on all injected constructor dependencies. No logic in constructors.
- Explicit return types on every service method (`Promise<ArticleResponseDto>`,
  never `Promise<any>`).
- **TSDoc on every public service method** — what it does and when it throws.
  Do not document obvious getters/setters, constructors, or trivial methods.
- Use `@InjectRepository(Entity)` directly in services. Only create a
  `.repository.ts` when a query is complex enough to warrant its own class.

## Controllers

- `@HttpCode()` when the status code differs from the NestJS default.
- Use `ParseUuidParamPipe` (from `src/common/pipes`) on all UUID path params —
  **not** the bare `ParseUUIDPipe` — so malformed-UUID errors are localized.
- **Route authentication is default-deny.** Every route requires an authenticated
  principal: the authentication guard is registered **globally** in `app.module.ts`, and
  anonymous access is opted into explicitly, per route, with `@Public()`. A new endpoint is
  authenticated unless it says otherwise, so forgetting the decorator fails closed. The
  opt-out list is limited to routes that genuinely cannot carry a principal yet — sign-in,
  registration, email verification, password recovery, and `health`. Registering the guard
  is half the rule: a missing global registration leaves zero `@Public()` decorators and an
  entirely unauthenticated API, which looks identical to a clean one.
- Auth decorators (`@Public()`, guards, etc.) are Phase 2 territory; this skeleton has
  none and no guard is registered, and `health` is intentionally unauthenticated — the
  bullet above is the standing rule for when Phase 2 adds them.

## DTO validation

- Validate all input via DTO class-validator decorators — never validate
  manually in controllers or services.
- `readonly` on all DTO fields.
- Every fallible decorator carries a localized
  `validationMessage('validation.KEY')` (from `src/common/i18n`) — never a
  literal `message:` string. The global pipe is `I18nValidationPipe`.
- Money fields: `@IsInt()` + `@Min(0)` — never float (see data-conventions).
- Enums belong beside the domain that defines them (in `__FORGE_SCOPE__/core`,
  once a domain exists) — never inline string literals.

## Exceptions & error responses

- Prefer NestJS built-in exceptions (`NotFoundException`, `BadRequestException`,
  `ForbiddenException`, `ConflictException`, `UnprocessableEntityException`)
  over raw `HttpException`.
- Throw them with a `{ messageKey, args? }` payload (typed
  `TranslatableErrorResponse` from `src/common/i18n`) — **never** a literal
  string:
  ```ts
  throw new NotFoundException({ messageKey: 'errors.articles.not_found' } satisfies TranslatableErrorResponse);
  throw new BadRequestException({ messageKey: 'errors.tags.not_found', args: { tagId } } satisfies TranslatableErrorResponse);
  ```
  Multi-field business-rule errors carry `details: TranslatableDetail[]`
  (`{ field, messageKey, args? }`).
- Standard error shape (produced by the global `HttpExceptionFilter`):
  ```json
  { "error": "Bad Request", "message": "Validation failed", "details": [{ "field": "title", "message": "Title is required" }] }
  ```
  The `error` field stays the canonical HTTP reason phrase (a protocol
  identifier, not localized). Validation errors automatically produce the
  `details` array via the global `I18nValidationPipe`.
- Status codes: 400 (validation), 401 (unauthenticated), 403 (forbidden),
  404 (not found), 409 (conflict/duplicate), 422 (business rule violation),
  500 (server error).

## nestjs-i18n mechanics

The "no hardcoded user-facing text" philosophy is in
`docs/standards/i18n.md`. The backend mechanics:

- **Translation strings** live in `src/i18n/en/{errors,validation,messages}.json`.
  This skeleton has no translated routes yet, so `I18nModule` is not registered
  in `app.module.ts` — the global `HttpExceptionFilter` / `I18nResponseInterceptor`
  fall back to the raw key when no `I18nContext` is present. Register
  `I18nModule.forRoot(...)` (with a `typesOutputPath` so keys are typed against a
  generated shape) the first time a route needs a real translated response, and
  `en` is currently the only locale — adding one is a new `src/i18n/<lang>/`
  folder, no code changes.
  - **Mind the compiled layout when you set `loaderOptions.path`.** `nest-cli.json`
    copies `i18n/**/*` as an asset and it lands at `dist/i18n`, but compiled code
    lives at `dist/apps/backend/src/**` (the backend's `tsconfig.json` pins `rootDir`
    to the workspace root — see the comment there). The idiomatic
    `join(__dirname, '/i18n/')` from the nestjs-i18n docs is therefore wrong by three
    levels here; from `src/app.module.ts` the built path is
    `join(__dirname, '../../../i18n/')`. Resolve it from `process.cwd()` or verify it
    against a production build — this is not visible in `nest start`.
- **Services stay i18n-agnostic** — they throw the `{ messageKey, args? }`
  payload and never call the i18n service themselves.
- **Translation happens only at the HTTP boundary**: `HttpExceptionFilter`
  translates exception keys; `I18nResponseInterceptor` translates success
  bodies carrying a `messageKey` (the `TranslatableResult` shape).
- **Tests** assert the thrown key, not literal text:
  `await expect(...).rejects.toMatchObject({ response: { messageKey: 'errors.articles.not_found' } })`.
  Do not add `I18nService` mocks to service specs — mock `I18nContext.current`
  instead (see `src/common/filters/__tests__/http-exception.filter.spec.ts`).

## Pagination

All list endpoints return `{ data: T[], meta: { total, page, limit, totalPages } }`.
Query params: `page` (default 1), `limit` (default 20, max 100).

```ts
const [items, total] = await this.repository.findAndCount({
  where: filters,
  skip: (page - 1) * limit,
  take: limit,
});
return { data: items.map(ItemResponseDto.fromEntity), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
```

## TypeORM & migrations

- **Always generate migrations from entity changes** (`npm run migration:generate`).
  Never write migrations by hand unless fixing a generated one.
- Migration names are PascalCase and describe the change (`AddArticlePublishedAt`,
  not `Migration1234`). Always read the generated file to verify it.
- The `down()` method must be the exact inverse of `up()` — never empty or a TODO.
- Use transactions for operations that modify multiple tables.
- Entity conventions (UUID PKs, soft deletes, money-as-int, UTC, PG enum types)
  are authoritative in `docs/standards/data-conventions.md`; once a domain RFC
  exists, exact field lists belong there (ADR-0003/ADR-0004), not here.
- Use `forwardRef()` for circular module dependencies.

## Jest testing specifics

The testing philosophy is in `docs/standards/testing.md`. The
backend specifics:

- Name test files `*.spec.ts`, co-located in `__tests__/` within the module.
- Use `Test.createTestingModule` from `@nestjs/testing` for module setup.
- Mock TypeORM repos / other services with `jest.fn()` / `jest.spyOn()`;
  provide repos via `getRepositoryToken(Entity)`. Type mocks as
  `jest.Mocked<T>` — never `any`.
- `afterEach(() => jest.clearAllMocks())` always present.
- Cover the happy path AND at least one error case per public method (not found,
  unauthorized, validation failure), plus enum-driven behavior variations.
- Assert thrown i18n keys, not literal text (see nestjs-i18n above).

**`nx test backend` does not type-check.** `tsconfig.json` extends `tsconfig.base.json`,
which sets `isolatedModules: true`, and `jest.config.ts` transforms with `ts-jest` — the
combination is transpile-only, so a spec containing a blatant type error (`const count:
number = 'not a number'`) compiles away and the suite passes green. Type-level assertions
are enforced **only** by the `typecheck` target (`tsc --noEmit`), which CI runs as a
mandatory sibling of `test`; `tsconfig.json`'s `include` covers `src/**/*.ts`, so the specs
are inside it. A green local `npm test` is evidence about runtime behaviour and nothing
else. The same property holds in `libs/core` — see its `STANDARDS.md`.

## Review dimensions

| ID | Check | Signal | Severity | Source |
|----|-------|--------|----------|--------|
| B1 | Controllers hold no business logic | `grep -rn "Repository\|getRepository" src/ --include='*.controller.ts'` | blocking | STANDARDS.md — Service/controller split |
| B2 | Every module follows the module/controller/service/dto layout | directory listing of the changed module | blocking | STANDARDS.md — Module layout |
| B3 | Entity change is accompanied by a migration | a changed `*.entity.ts` with no new file in `src/db/migrations/` | blocking | STANDARDS.md — Migrations |
| B4 | No `synchronize: true` anywhere | `grep -rn "synchronize: true" src/` | blocking | STANDARDS.md — Migrations |
| B5 | Request payloads are validated DTOs | `grep -rn "@Body()" src/` — each must reference a DTO class | blocking | STANDARDS.md — DTOs |
| B6 | Errors use the shared exception filter shape | `grep -rn "throw new HttpException" src/` | warning | STANDARDS.md — Error shape |
| B7 | User-facing strings are translated | `grep -rnE "'[A-Z][a-z]+ [a-z]+" src/ --include='*.service.ts'` | warning | `docs/standards/i18n.md` |
| B8 | Every route is authenticated unless it explicitly opts out | `grep -rn "@Public()" src/ --include='*.controller.ts'` — every hit must be a route that genuinely needs anonymous access (sign-in, registration, email verification, password recovery, health) **and** confirm the global authentication guard is registered in `app.module.ts`: with no guard registered there are zero hits and the row reads green while nothing is authenticated | blocking | STANDARDS.md — Route authentication is default-deny |
| B9 | Secret material never reaches a response | `grep -rni -e hash -e secret -e token src/ --include='*.dto.ts'` — a response DTO carrying any of them is a violation unless it is a single-use credential the caller just asked to be issued. **Covers `*.dto.ts` only**: a secret returned through a controller's inline return type, a directly-serialized entity, or a core wire shape is invisible to it, so read the changed controller's return types too | blocking | ADR-0005 — identities carry no secret material |
| B10 | A state change worth reconstructing later is audited | **read and judge** — a changed `*.service.ts` method that writes and does not call `IAuditService.record()`. No grep separates a write that matters from one that does not; the reviewer reads the diff. | warning | ADR-0007 — the audit record carries the tenant it happened in |
