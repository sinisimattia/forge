# Forge Phase 6 — Hardening and Abuse Resistance: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit how often a credential or a second factor may be attempted, close the
enrolment escalation that lets a stolen session take over an account's second factor, bring
the codebase into line with ADR-0013, and drain the cheap debt Phase 5 carried.

**Architecture:** `@nestjs/throttler` is adopted rather than reimplemented, adapted at three
of its published extension points: the tracker returns a server-known subject instead of a
network address, the refusal raises a core `DomainError` instead of a framework exception,
and the counter store is a Postgres table instead of an in-process map. `libs/core` learns
nothing about any of it; the one policy it gains is a domain rule that would exist anyway.

**Tech Stack:** NestJS 11, `@nestjs/throttler` 6.7.x, `@nestjs/terminus`, TypeORM 0.3,
Postgres 16, Jest 30, Nuxt 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-01-forge-phase-6-hardening-design.md`

## Global Constraints

- **`~/Progetti/Voku` is read-only.** Never write to it; never run a command there that could change tracked or untracked state. Before and after each task, confirm `git -C ~/Progetti/Voku status --porcelain` is empty and `git -C ~/Progetti/Voku rev-parse HEAD` is `fdfdbdeae2891954dd1cac538a082d5837f281dd`. **These two read-only commands are required, not forbidden.**
- **The generator takes no dependencies.** `tools/create/` and `tests/` use Node builtins only; the ROOT `package.json` has no `dependencies` and no `devDependencies`. This phase adds packages to `template/apps/backend/package.json` only, which is a different file and is allowed.
- **`npm run sanitize` must pass before any commit touching `template/`.** Never weaken a rule to make a commit pass. `tools/sanitize.mjs` stays byte-identical.
- **Never add a foreign key to `audit_entries`,** in either direction. A referential action runs with the table owner's privileges and voids ADR-0009.
- **`libs/core` is framework-agnostic and transport-free in prose as well as imports.** No `@nestjs/*`, `typeorm`, `nuxt`, `vue`, `pinia` import, and no naming of them, HTTP, cookies, JWT, status codes or header names in TSDoc. `npm run purity -w libs/core` enforces the prose half. `grep -riE "\bjwt\b|cookie|http" template/libs/core/src` must return nothing.
- **ADR-0013 governs every mechanism choice.** Use the framework's component, adapt at its published extension point, and record any departure beside the code naming the framework's answer and what it fails to do here.
- **State the invariant, not the enumeration.** A comment that counts ("both callers", "the only place", "eight call sites") is true when written and rots silently. Correcting a count resets the clock.
- **Every `switch` over an enum or discriminated union ends in `default: return assertNever(value)`.**
- **Docker headroom** is measured with `docker run --rm alpine df -h /`, never `docker system df`. Never stop, remove or reconfigure a container this work did not create.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- The template is tokenised (`__FORGE_SCOPE__`, `__FORGE_NAME__`) and cannot be `npm install`ed in place. Gates that need a real install run against a project generated into a scratch directory.

## Review Focus

Five conditions the spec implies that no task's happy path exercises. Each has a test
assigned to the task that owns the code; they are listed here together because they share a
cause — the limiter runs earlier in the request than anything that validates it.

1. **A throttled request whose subject is missing or the wrong type.** `ThrottlerGuard` runs before the global `I18nValidationPipe`, so `getTracker` sees the raw parsed body: `POST /auth/login` with no `email`, with `email: null`, or with `email: {}` all reach it. Returning `undefined` makes every such request share one bucket, which is a denial-of-service lever; throwing makes a malformed body a `500`. Pinned in **Task 6**.
2. **Two processes incrementing one key at the same time.** This is the entire reason the storage adapter exists, and it is the one property an in-process fake cannot demonstrate. Pinned in **Task 5**, against a real Postgres.
3. **A request arriving exactly on the window boundary**, where `expires_at` equals `now()`. The reset branch and the increment branch must not both apply, and must not both be skipped. Pinned in **Task 5**.
4. **An unknown or malformed challenge token on `POST /auth/mfa/verify`.** The subject for `mfa-attempt` is the challenge, so a token naming no challenge must still be metered — otherwise an attacker gets unlimited free attempts by sending garbage, and the throttle only ever meters honest callers. Pinned in **Task 7**.
5. **`rate_limit_counters` growing without bound.** The sweep runs on the write path, so keys that stop being written are never revisited. The sweep must therefore delete by `expires_at` across the table, not only the key in hand. Pinned in **Task 5**.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `template/libs/core/src/shared/errors/TooManyAttemptsError.ts` | the domain error a refused attempt raises |
| `template/libs/core/src/mfa/enums/MfaEnrollmentDecision.ts` | whether confirming a factor needs a live proof |
| `template/libs/core/src/mfa/policies/decideMfaEnrollment.ts` | the pure rule behind that decision |
| `template/apps/backend/src/db/migrations/1758000006000-RateLimitCounters.ts` | the counter table and the missing challenge index |
| `template/apps/backend/src/throttling/rate-limit-counter.entity.ts` | the row TypeORM maps |
| `template/apps/backend/src/throttling/postgres-throttler.storage.ts` | `ThrottlerStorage` over Postgres, sweeping on write |
| `template/apps/backend/src/throttling/forge-throttler.guard.ts` | the two guard adaptations: tracker and refusal |
| `template/apps/backend/src/throttling/throttling.config.ts` | bucket names, limits, windows, read through `@nestjs/config` |
| `template/apps/backend/src/throttling/throttling.module.ts` | assembles the above |
| `template/apps/backend/src/health/health.controller.ts` | rewritten on terminus: liveness and readiness |

**Modified:** `app.module.ts` (entity list, `GLOBAL_PROVIDERS`, module imports),
`common/filters/http-exception.filter.ts` (one table row), `i18n/en/errors.json` (one key),
`mfa/mfa.controller.ts` and `auth/auth.controller.ts` (bucket decorators),
`mfa/mfa.service.ts` (enrolment proof, method bound, remaining-code count),
`mfa/recovery/recovery-codes.ts` (alphabet), `mfa/webauthn/WebAuthnCeremonies.ts` (TTL
carry-forward), `libs/core/src/audit/enums/AuditAction.ts` (one member), both compose files
(healthcheck paths), and the webapp's method fetcher and security screen.

---

### Task 1: Liveness and readiness on `@nestjs/terminus`

The shipped `GET /health` returns `{ status: 'ok' }` without consulting anything, so a
backend whose database connection is gone reports healthy for ever and every container
waiting on `service_healthy` starts against something that answers `500` to every real
request. ADR-0013: the framework ships terminus for this.

`GET /health` keeps its path, its contract and its `@Public()`, because both compose files,
`template/.github/workflows/ci.yml:67` and three assertions in `tests/integration/docker.test.mjs`
poll it, and because liveness genuinely should not consult the database — a container that
restarts itself whenever the database blips is worse than one that reports unready. The new
`GET /health/ready` is the one that checks, and it is what the healthchecks move to.

**Files:**
- Modify: `template/apps/backend/package.json` (add `@nestjs/terminus`)
- Modify: `template/apps/backend/src/health/health.controller.ts`
- Modify: `template/apps/backend/src/health/health.module.ts`
- Modify: `template/compose.yaml:114`, `template/compose.prod.yaml:139`
- Test: `template/apps/backend/src/health/__tests__/health.controller.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET /health` → `{ status: 'ok' }` (unchanged); `GET /health/ready` → terminus's
  result shape, `200` when the database answers and `503` when it does not.

- [ ] **Step 1: Add the dependency**

```bash
cd template/apps/backend && npm pkg set dependencies.@nestjs/terminus="^12.1.0" && cd -
```

Do not run `npm install` in `template/` — it is tokenised and cannot resolve
`__FORGE_SCOPE__/core`. The generated-project gate installs it.

- [ ] **Step 2: Write the failing tests**

Replace the body of `template/apps/backend/src/health/__tests__/health.controller.spec.ts`
with these three cases, keeping any existing import style in the file:

```ts
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from '../health.controller';

/** A ping that resolves, standing in for a reachable database. */
const up = { database: { status: 'up' as const } };

async function controllerWith(ping: () => unknown): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule],
    controllers: [HealthController],
  })
    .overrideProvider(TypeOrmHealthIndicator)
    .useValue({ pingCheck: () => ({ withTimeout: () => ping() }) })
    .compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('liveness answers without consulting anything', async () => {
    const controller = await controllerWith(() => {
      throw new Error('liveness must not touch the database');
    });
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('readiness reports up when the database answers', async () => {
    const controller = await controllerWith(() => Promise.resolve(up));
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ok' });
  });

  it('readiness fails when the database does not answer', async () => {
    const controller = await controllerWith(() =>
      Promise.reject(new Error('connection terminated')),
    );
    await expect(controller.ready()).rejects.toBeDefined();
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx nx test backend -- health.controller`
Expected: FAIL — `controller.live is not a function`, and `ready` does not exist.

- [ ] **Step 4: Rewrite the controller**

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Public } from '../auth/decorators';

/**
 * Whether this process is alive, and whether it is ready to serve.
 *
 * Both are `@Public()`. The global `JwtAuthGuard` closes every route by
 * default, and a `401` here is worse than it looks: a `401` is a response, so
 * the healthcheck's `fetch` resolves, `r.ok` is false, the container is
 * reported unhealthy for ever, and everything waiting on `service_healthy`
 * never starts. That is the whole stack failing to boot on account of a
 * decorator nobody thought was part of liveness.
 *
 * ## Why these are two endpoints
 *
 * They answer different questions and the wrong answer to each costs something
 * different. Liveness asks whether the process should be killed and replaced;
 * it consults nothing, because a process that restarts itself every time the
 * database blips turns a brief outage into a restart loop. Readiness asks
 * whether this instance should be sent traffic, and that question genuinely
 * depends on the database: an instance that cannot reach it answers `500` to
 * everything, and saying so is the entire point.
 */
@Controller('health')
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
  ) {}

  /** Liveness. Consults nothing, deliberately — see the class documentation. */
  @Public()
  @Get()
  public live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: can this instance actually serve a request?
   *
   * The timeout is shorter than the healthcheck interval in both compose
   * files, so a hung database is reported rather than leaving the probe itself
   * hanging until the orchestrator's own timeout fires.
   */
  @Public()
  @Get('ready')
  @HealthCheck()
  public async ready(): Promise<ReturnType<HealthCheckService['check']>> {
    return this.health.check([() => this.database.pingCheck('database').withTimeout(3000)]);
  }
}
```

And the module:

```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({ imports: [TerminusModule], controllers: [HealthController] })
export class HealthModule {}
```

- [ ] **Step 5: Run the tests again**

Run: `npx nx test backend -- health.controller`
Expected: PASS, three cases.

- [ ] **Step 6: Point the container healthchecks at readiness**

In `template/compose.yaml` and `template/compose.prod.yaml`, change the backend
healthcheck's URL from `http://127.0.0.1:3000/health` to
`http://127.0.0.1:3000/health/ready`. Leave the interval, timeout, retries and
`start_period` alone. Add above each:

```yaml
      # Readiness, not liveness: this gate exists so that whatever waits on
      # `service_healthy` waits for a backend that can actually serve, and the
      # liveness endpoint answers `ok` with its database gone.
```

- [ ] **Step 7: Extend the docker tier to prove the difference**

In `tests/integration/docker.test.mjs`, beside the existing `GET /health` assertion at
line 362, add a readiness assertion in the same test:

```js
    const ready = await call(base, 'GET', '/health/ready');
    assert.equal(ready.status, 200, 'readiness answers 200 against a live database');
    assert.equal(ready.body.status, 'ok');
    assert.equal(ready.body.info.database.status, 'up');
```

- [ ] **Step 8: Run the gates**

```bash
npx nx test backend && npx nx lint backend && npm run sanitize
```

- [ ] **Step 9: Commit**

```bash
git add template/apps/backend template/compose.yaml template/compose.prod.yaml tests/integration/docker.test.mjs
git commit -m "fix(health): readiness consults the database, liveness deliberately does not

The shipped endpoint returned ok without consulting anything, so a backend
whose database was gone reported healthy for ever and everything waiting on
service_healthy started against something that answered 500 to every request.

GET /health keeps its path and contract — both compose files, CI and three
docker-tier assertions poll it, and liveness genuinely should not consult the
database. GET /health/ready is the new one, and the healthchecks move to it.

ADR-0013: @nestjs/terminus rather than a hand-rolled check.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The webapp's departure from the framework's fetch

`template/apps/webapp/app/fetchers/client.ts` uses the platform's `fetch` and justifies it
with: *"the renewal cookie only travels when the request asks for it, that is a `fetch`
option"*. That is not a reason — `ofetch`'s options type is
`interface FetchOptions<...> extends Omit<RequestInit, "body">`, so `credentials` is accepted
and forwarded like any other request option. Verified against `ofetch@1.5.1`.

**This task does not assume the conclusion.** There may be a sound reason to keep the
platform's `fetch`: `$fetch` rejects on a non-2xx response and parses the body on the way,
and this client's whole job is to inspect a `401` and decide whether to renew — the one case
where being handed an exception instead of a response is a cost. Establish which is true by
reading the dependency, then do exactly one of the two things below. Not both, and not
neither: a false justification left in place is worse than none, because it reads as having
been checked.

**Files:**
- Modify: `template/apps/webapp/app/fetchers/client.ts:134-150`
- Test: `template/apps/webapp/app/fetchers/__tests__/client.spec.ts` (only if the transport changes)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createApiClient(options: ApiClientOptions): ApiClient` — unchanged signature
  either way. No caller changes.

- [ ] **Step 1: Read the dependency and decide**

```bash
node -e "console.log(require.resolve('ofetch'))" 2>/dev/null || echo "generate a project first"
```

Read `ofetch`'s exported `FetchOptions` type and its error behaviour. Write the finding into
the task report in one sentence: whether `$fetch` can express what this client needs —
`credentials`, a request timeout, and **reading a `401` as a value rather than catching it**.

- [ ] **Step 2a: If `$fetch` fits — migrate, and keep the behaviour identical**

Replace the `fetch(...)` call with `$fetch.raw(...)`, which returns the response rather than
the parsed body and does not reject on a non-2xx status, keeping the `401` path a value.
Carry `credentials`, `signal` and `headers` across unchanged. Then run the webapp suite and
confirm the renewal tests still pass — they are the ones that would catch a regression:

```bash
npx nx test webapp
```

- [ ] **Step 2b: If `$fetch` does not fit — replace the justification with the true one**

Keep the platform `fetch` and rewrite the paragraph. State the real reason and do not
mention `credentials`, which is not one. For example, if the finding is the error behaviour:

```ts
/**
 * The transport the application really runs on.
 *
 * The platform's `fetch` rather than the framework's wrapper, and the reason is
 * the `401`: this client's job is to read a refusal as a value and decide
 * whether to renew, and the wrapper rejects on a non-2xx response instead of
 * returning one. Catching an exception to recover the status the renewal path
 * needs would be more indirection than the wrapper removes. `credentials` is
 * not a reason — the wrapper's options extend `RequestInit` and forward it.
 */
```

The last sentence is load-bearing: it stops the next person re-deriving the wrong reason
from the same starting point.

- [ ] **Step 3: Run the gates**

```bash
npx nx test webapp && npx nx lint webapp && npm run sanitize
```

- [ ] **Step 4: Commit**

```bash
git add template/apps/webapp
git commit -m "fix(webapp): the fetch departure rests on a claim that was not true

ofetch's FetchOptions extends Omit<RequestInit, 'body'>, so credentials is
forwarded like any other option and was never a reason to avoid it. Verified
against ofetch@1.5.1.

Not a comment that drifted out of true — one that was never true, about a
property of a dependency nobody checked. It read as having been considered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `TooManyAttemptsError`, and the route from it to a response

The guard's refusal must arrive where every other failure in this application arrives. The
library's own exception is an `HttpException`, which bypasses both `HttpExceptionFilter`'s
table and the translation that table performs — so the adaptation ADR-0013 calls for is to
raise a core `DomainError` instead.

It goes in `shared/errors/` rather than a domain folder because the rule spans
authentication, identities and second factors. Its documentation describes a budget and
names no status code, header or framework: `npm run purity -w libs/core` reads it.

**Files:**
- Create: `template/libs/core/src/shared/errors/TooManyAttemptsError.ts`
- Modify: `template/libs/core/src/shared/errors/index.ts`
- Modify: `template/apps/backend/src/common/filters/http-exception.filter.ts`
- Modify: `template/apps/backend/src/i18n/en/errors.json`
- Test: `template/libs/core/tests/shared/errors/TooManyAttemptsError.spec.ts`
- Test: `template/apps/backend/src/common/filters/__tests__/http-exception.filter.spec.ts`

**Interfaces:**
- Consumes: `DomainError` from `__FORGE_SCOPE__/core/shared/errors`.
- Produces: `class TooManyAttemptsError extends DomainError`, constructed
  `new TooManyAttemptsError(retryAfterSeconds: number)`, with a readonly
  `retryAfterSeconds: number`. Task 6 constructs it; nothing else does.

- [ ] **Step 1: Write the failing core test**

Create `template/libs/core/tests/shared/errors/TooManyAttemptsError.spec.ts`:

```ts
import { DomainError, TooManyAttemptsError } from '__FORGE_SCOPE__/core/shared/errors';

describe('TooManyAttemptsError', () => {
  it('is a DomainError, so a broad catch sees it', () => {
    expect(new TooManyAttemptsError(900)).toBeInstanceOf(DomainError);
  });

  it('carries how long the caller must wait', () => {
    expect(new TooManyAttemptsError(900).retryAfterSeconds).toBe(900);
  });

  it('names itself, so a log says which invariant was violated', () => {
    expect(new TooManyAttemptsError(900).name).toBe('TooManyAttemptsError');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx nx test core -- TooManyAttemptsError`
Expected: FAIL — `TooManyAttemptsError` is not exported.

- [ ] **Step 3: Write the error**

Create `template/libs/core/src/shared/errors/TooManyAttemptsError.ts`:

```ts
import { DomainError } from './DomainError';

/**
 * Raised when something has been attempted more often than the budget for it
 * allows, and the caller must wait before attempting it again.
 *
 * ## Why this is a domain error and not an infrastructure one
 *
 * The rule it states is a domain rule: *an account may not be asked to prove
 * itself without limit.* A secret short enough for a person to read off a
 * screen is only as strong as the number of guesses it will tolerate, so the
 * budget is part of what the proof is worth rather than a detail of how the
 * attempt arrived. Counting the attempts — over what window, in what store,
 * shared between what processes — is infrastructure, and none of it is stated
 * here.
 *
 * It lives beside the other cross-domain primitives because the rule is not
 * one domain's: proving an identity, answering a challenge and spending a
 * recovery code are all attempts against the same kind of budget, and an
 * error per domain would be three names for one invariant.
 *
 * {@link TooManyAttemptsError.retryAfterSeconds} is modelled because the
 * caller it refuses is usually the rightful owner, who has typed something
 * wrong and needs to know when to try again. It is a duration rather than an
 * instant so that it says the same thing regardless of whose clock reads it.
 *
 * @param retryAfterSeconds - how long the caller must wait, in seconds
 */
export class TooManyAttemptsError extends DomainError {
  public constructor(public readonly retryAfterSeconds: number) {
    super('Too many attempts. Wait before trying again.');
  }
}
```

Append to `template/libs/core/src/shared/errors/index.ts`:

```ts
export * from './TooManyAttemptsError';
```

- [ ] **Step 4: Run the core test and the purity gate**

```bash
npx nx test core -- TooManyAttemptsError && npm run purity -w libs/core && npx nx typecheck core
```
Expected: PASS, and purity clean. If purity objects, a word in the TSDoc is transport
vocabulary — rewrite the sentence rather than exempting the file.

- [ ] **Step 5: Add the translation and the table row**

In `template/apps/backend/src/i18n/en/errors.json`, inside the existing `"common"` object:

```json
    "too_many_attempts": "Too many attempts. Wait a moment and try again"
```

The message deliberately says nothing about which bucket refused, how many attempts were
made or whether the subject exists. See Task 6's note on the oracle.

In `template/apps/backend/src/common/filters/http-exception.filter.ts`, import
`TooManyAttemptsError` from `__FORGE_SCOPE__/core/shared/errors` beside the existing
`DomainError` import, and add one row to the `DOMAIN_ERRORS` table, keeping the file's
single-line row style:

```ts
  { type: TooManyAttemptsError, status: HttpStatus.TOO_MANY_REQUESTS, messageKey: 'errors.common.too_many_attempts', code: 'TOO_MANY_ATTEMPTS' },
```

- [ ] **Step 6: Write the filter test**

Add to `template/apps/backend/src/common/filters/__tests__/http-exception.filter.spec.ts`,
matching the file's existing arrangement for raising a domain error through the filter:

```ts
  it('answers 429 with a translated message for TooManyAttemptsError', async () => {
    const response = await raise(new TooManyAttemptsError(900));
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(response.body.message).not.toBe('errors.common.too_many_attempts');
  });
```

The last assertion is the one that matters: an untranslated key reaching the wire is the
failure this table exists to prevent, and asserting the key would pass in exactly that case.

- [ ] **Step 7: Run the gates**

```bash
npx nx test core && npx nx test backend && npx nx lint backend && npm run sanitize
```

- [ ] **Step 8: Commit**

```bash
git add template/libs/core template/apps/backend
git commit -m "feat(core): TooManyAttemptsError, and the route from it to a 429

A refused attempt has to arrive where every other failure arrives. The
throttler's own exception bypasses both the filter's table and the translation
that table performs, so the adaptation ADR-0013 calls for is to raise a domain
error instead.

shared/errors rather than a domain folder: proving an identity, answering a
challenge and spending a recovery code are attempts against the same kind of
budget, and an error per domain would be three names for one invariant.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `rate_limit_counters`, and the index Phase 5 left out

One migration, because both statements are schema and the index is one line. No `GRANT`:
`AppRoleAndDefaultPrivileges1758000000000` set the default privileges, so a table created
after it is readable and writable by the application role — the same ordering every feature
migration since has relied on.

**Files:**
- Create: `template/apps/backend/src/db/migrations/1758000006000-RateLimitCounters.ts`
- Create: `template/apps/backend/src/throttling/rate-limit-counter.entity.ts`
- Modify: `template/apps/backend/src/app.module.ts` (entity list)
- Test: `template/apps/backend/src/db/migrations/__tests__/migration-sql.spec.ts` (existing guards pick it up)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: table `rate_limit_counters (key text PRIMARY KEY, hits integer NOT NULL,
  expires_at timestamptz NOT NULL, blocked_until timestamptz NULL)`, and the entity
  `RateLimitCounterRecord` mapping it with properties `key`, `hits`, `expiresAt`,
  `blockedUntil`. Task 5 queries it.

- [ ] **Step 1: Write the migration**

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `rate_limit_counters` — one row per throttled subject per window.
 *
 * Runs as the schema owner, after `AppRoleAndDefaultPrivileges1758000000000`
 * has set the default privileges, so this table becomes readable and writable
 * by the application role with no `GRANT` in this file. See that migration's
 * own TSDoc for why the ordering is load-bearing.
 *
 * ## Why a table, when the library ships a store
 *
 * The bundled store is a map in the process. With one instance it is correct.
 * With several, each keeps its own count, so the effective limit becomes the
 * configured one multiplied by the number of instances — silently, with every
 * test green, because nothing in a single-process suite can observe it. A
 * limit that quietly is not the limit is the failure this schema exists to
 * prevent.
 *
 * ## `key` is the primary key, and it is opaque here
 *
 * The library composes it from the bucket's name and the subject. This table
 * does not parse it and must not: what a subject is belongs to the tracker,
 * and a schema that knew would have to change whenever a bucket did.
 *
 * ## No foreign key to `users`
 *
 * A row's subject is often an account, and it is deliberately not a reference.
 * The counter must survive the thing it counts — an attempt against an address
 * that names nobody is exactly the case that must still be metered — and a
 * referential action here would delete a live budget when an account went away.
 */
export class RateLimitCounters1758000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rate_limit_counters (
        key           text        PRIMARY KEY,
        hits          integer     NOT NULL,
        expires_at    timestamptz NOT NULL,
        blocked_until timestamptz NULL
      )
    `);
    // What the sweep for finished windows is run against. Without it the sweep
    // is a sequential scan of every subject ever counted.
    await queryRunner.query(
      'CREATE INDEX ix_rate_limit_counters_expires_at ON rate_limit_counters (expires_at)',
    );
    await queryRunner.query(`
      COMMENT ON COLUMN rate_limit_counters.key IS
        'Bucket and subject, composed by the application. Opaque here: this table never parses it.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN rate_limit_counters.blocked_until IS
        'When the refusal lifts, or NULL while the subject is still within its budget.'
    `);
    // Phase 5 shipped `mfa_challenges` without this. The sweep that runs on
    // every mint filters on `expires_at`, so it scanned the whole table.
    await queryRunner.query(
      'CREATE INDEX ix_mfa_challenges_expires_at ON mfa_challenges (expires_at)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_mfa_challenges_expires_at');
    await queryRunner.query('DROP TABLE rate_limit_counters');
  }
}
```

- [ ] **Step 2: Write the entity**

```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** A row of `rate_limit_counters`: one throttled subject's current window. */
@Entity({ name: 'rate_limit_counters' })
export class RateLimitCounterRecord {
  /** Bucket and subject, composed by the application and opaque to the schema. */
  @PrimaryColumn({ type: 'text' })
  public key!: string;

  /** Attempts recorded in the window that ends at {@link RateLimitCounterRecord.expiresAt}. */
  @Column({ type: 'integer' })
  public hits!: number;

  /** When the current window ends and the count resets. */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  public expiresAt!: Date;

  /** When the refusal lifts, or `null` while the subject is within its budget. */
  @Column({ name: 'blocked_until', type: 'timestamptz', nullable: true })
  public blockedUntil!: Date | null;
}
```

- [ ] **Step 3: Register the entity**

In `template/apps/backend/src/app.module.ts`, import `RateLimitCounterRecord` from
`./throttling/rate-limit-counter.entity` and add it to the `entities` array in
`typeOrmOptions`, after `MfaRecoveryCodeRecord`. The schema-drift probe in
`tests/integration/docker.test.mjs` asserts the exact set of tables TypeORM maps, so a
missing registration turns it red.

- [ ] **Step 4: Run the migration guards**

```bash
npx nx test backend -- migration-sql
```
Expected: PASS. That spec asserts the exact set of `eslint-disable` exemptions in the
migrations directory — this migration adds none, because it interpolates no role name.

- [ ] **Step 5: Update the drift probe's expected table list**

In `tests/integration/docker.test.mjs`, add `rate_limit_counters` to the expected set of
tables, keeping the list's existing alphabetical or declaration order.

- [ ] **Step 6: Run the gates**

```bash
npx nx test backend && npx nx lint backend && npm run sanitize
```

- [ ] **Step 7: Commit**

```bash
git add template/apps/backend tests/integration/docker.test.mjs
git commit -m "feat(db): rate_limit_counters, and the mfa_challenges index Phase 5 left out

The counter store is a table rather than the library's in-process map, because
with several instances each keeps its own count and the effective limit becomes
the configured one multiplied by the instance count — silently, with every test
green, since nothing in a single-process suite can observe it.

No foreign key to users: an attempt against an address naming nobody is exactly
the case that must still be metered, and the counter has to survive the thing
it counts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `PostgresThrottlerStorage`

Implements the library's one-method `ThrottlerStorage` interface over the table from Task 4.

**Read the bundled store's semantics before writing this** (`@nestjs/throttler/dist/throttler.service.js`),
because three of them are not what the type names suggest and getting any wrong is silent:

1. **`ttl` and `blockDuration` arrive in milliseconds.**
2. **`timeToExpire` and `timeToBlockExpire` are returned in *seconds*** — the bundled store
   divides by 1000 and rounds up. Returning milliseconds produces a `Retry-After` a thousand
   times too large and nothing fails.
3. **A blocked subject's hits are not counted.** The bundled store increments only when the
   subject is not currently blocked, and sets the block when `hits > limit` — strictly
   greater, so a limit of 5 permits 5 and refuses the 6th.

**One deliberate deviation, documented in the class:** the bundled store expires hits
individually, which makes it a sliding window. This one expires them together — a fixed
window. The cost is a burst at a window boundary, bounded above by twice the limit, which is
nothing against a six-digit grind; the gain is one row and one statement per subject instead
of a row per attempt. Anyone comparing against the library's documentation must find this
written down, or they will read it as a bug.

**Files:**
- Create: `template/apps/backend/src/throttling/postgres-throttler.storage.ts`
- Test: `template/apps/backend/src/throttling/__tests__/postgres-throttler.storage.spec.ts`
- Test: `tests/integration/docker.test.mjs` (the two-process case)

**Interfaces:**
- Consumes: `RateLimitCounterRecord` (Task 4).
- Produces: `class PostgresThrottlerStorage implements ThrottlerStorage` with
  `increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord>`.
  Task 6 binds it to the `ThrottlerStorage` token.

- [ ] **Step 1: Write the failing tests**

```ts
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PostgresThrottlerStorage } from '../postgres-throttler.storage';

/** 5 attempts per 60s, blocked for 120s once exceeded. */
const TTL = 60_000;
const LIMIT = 5;
const BLOCK = 120_000;

describe('PostgresThrottlerStorage', () => {
  let storage: PostgresThrottlerStorage;
  let dataSource: DataSource;

  beforeEach(async () => {
    // `fakeDataSourceFor` is this repository's existing helper in
    // `common/testing/fake-data-source.ts`; follow its current signature.
    ({ storage, dataSource } = await harness());
  });

  it('counts up to the limit without blocking', async () => {
    let record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    for (let i = 2; i <= LIMIT; i += 1) {
      record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    }
    expect(record.totalHits).toBe(LIMIT);
    expect(record.isBlocked).toBe(false);
  });

  it('blocks on the attempt after the limit, not on the limit itself', async () => {
    for (let i = 1; i <= LIMIT; i += 1) await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    const record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    expect(record.isBlocked).toBe(true);
    expect(record.totalHits).toBe(LIMIT + 1);
  });

  it('reports the retry window in SECONDS, not milliseconds', async () => {
    for (let i = 0; i <= LIMIT; i += 1) await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    const record = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    // 120s, not 120000. The bundled store divides by 1000 and rounds up; a
    // Retry-After a thousand times too large fails nothing and is still wrong.
    expect(record.timeToBlockExpire).toBeLessThanOrEqual(BLOCK / 1000);
    expect(record.timeToBlockExpire).toBeGreaterThan(BLOCK / 1000 - 5);
  });

  it('does not count a blocked subject up further', async () => {
    for (let i = 0; i <= LIMIT; i += 1) await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    const first = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    const second = await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    expect(second.totalHits).toBe(first.totalHits);
  });

  it('starts a fresh window once the old one has expired', async () => {
    // A 1ms window, so the next call is unambiguously past it.
    await storage.increment('k', 1, LIMIT, BLOCK, 'default');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const record = await storage.increment('k', 1, LIMIT, BLOCK, 'default');
    expect(record.totalHits).toBe(1);
  });

  it('keeps separate subjects separate', async () => {
    for (let i = 0; i <= LIMIT; i += 1) await storage.increment('a', TTL, LIMIT, BLOCK, 'default');
    const other = await storage.increment('b', TTL, LIMIT, BLOCK, 'default');
    expect(other.isBlocked).toBe(false);
  });

  // Review Focus 5: the sweep runs on the write path, so a key that stops
  // being written is never revisited by its own increment. It must therefore
  // delete by expiry across the table, not only the key in hand.
  it('sweeps finished windows belonging to other keys', async () => {
    await storage.increment('abandoned', 1, LIMIT, BLOCK, 'default');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await storage.increment('still-busy', TTL, LIMIT, BLOCK, 'default');
    const rows = await dataSource.query(
      "SELECT key FROM rate_limit_counters WHERE key = 'abandoned'",
    );
    expect(rows).toHaveLength(0);
  });

  // Review Focus 3: the boundary itself. A request arriving when expires_at
  // equals now() must take exactly one branch.
  it('treats the boundary as the start of a new window, once', async () => {
    await storage.increment('k', 0, LIMIT, BLOCK, 'default');
    const record = await storage.increment('k', 0, LIMIT, BLOCK, 'default');
    expect(record.totalHits).toBe(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx nx test backend -- postgres-throttler.storage`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the storage**

```ts
import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage, ThrottlerStorageRecord } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * The throttler's counters, in the database rather than in this process.
 *
 * ## Why the bundled store is not used
 *
 * It is a map in the process. With one instance it is correct. With several,
 * each keeps its own counters, so the effective limit becomes the configured
 * one multiplied by the number of instances — and nothing reports it, because
 * a single-process test suite cannot observe a disagreement between processes.
 * A limit that quietly is not the limit is the whole reason this class exists.
 *
 * ## One deliberate difference from the bundled store
 *
 * The bundled store gives every hit its own expiry, which makes it a sliding
 * window. This one expires a subject's hits together: a fixed window. The cost
 * is a burst across a window boundary, bounded above by twice the limit, which
 * is nothing against the kind of guessing these budgets exist to stop. The gain
 * is one row and one statement per subject rather than a row per attempt.
 * Recorded here because somebody reading the library's documentation alongside
 * this class will otherwise read the difference as a defect.
 *
 * ## Units, which are not what the parameter names suggest
 *
 * `ttl` and `blockDuration` arrive in **milliseconds**. `timeToExpire` and
 * `timeToBlockExpire` are returned in **seconds** — the bundled store divides
 * and rounds up, and the guard's retry header is built from them. Returning
 * milliseconds would tell every refused caller to wait a thousand times too
 * long, and no test of this class's own arithmetic would notice.
 */
@Injectable()
export class PostgresThrottlerStorage implements ThrottlerStorage {
  public constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Records one attempt against `key` and says where that leaves it.
   *
   * The whole decision is one statement, so two processes arriving together
   * cannot both read a stale count and both decide they are under the limit:
   * the second `ON CONFLICT` update sees the first one's row. A read followed
   * by a write would have exactly that race, and it would open only under the
   * concurrency an attacker is the most likely party to produce.
   *
   * A subject that is currently blocked is not counted further, matching the
   * bundled store: the block is the refusal, and counting during it would make
   * the recorded total a measure of the attacker's persistence rather than of
   * the budget.
   */
  public async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // Finished windows, across the table and not merely this key: the sweep
    // runs on the write path, so a subject that stops being attempted is never
    // revisited by its own increment. Cheap because of
    // `ix_rate_limit_counters_expires_at`. Same ruling as the challenge store's
    // sweep, and ADR-0013's departure clause: a sweep on a path nothing calls
    // is a sweep nobody notices has stopped.
    await this.dataSource.query(
      `DELETE FROM rate_limit_counters
        WHERE expires_at <= now()
          AND (blocked_until IS NULL OR blocked_until <= now())`,
    );

    const rows: { hits: number; expires_at: Date; blocked_until: Date | null }[] =
      await this.dataSource.query(
        `INSERT INTO rate_limit_counters AS c (key, hits, expires_at, blocked_until)
         VALUES ($1, 1, now() + $2::double precision * interval '1 millisecond', NULL)
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE
             WHEN c.expires_at <= now() THEN 1
             WHEN c.blocked_until IS NOT NULL AND c.blocked_until >  now() THEN c.hits
             WHEN c.blocked_until IS NOT NULL AND c.blocked_until <= now() THEN 1
             ELSE c.hits + 1
           END,
           expires_at = CASE
             WHEN c.expires_at <= now()
               THEN now() + $2::double precision * interval '1 millisecond'
             ELSE c.expires_at
           END,
           blocked_until = CASE
             WHEN c.expires_at <= now() THEN NULL
             WHEN c.blocked_until IS NOT NULL AND c.blocked_until >  now() THEN c.blocked_until
             WHEN c.blocked_until IS NOT NULL AND c.blocked_until <= now() THEN NULL
             WHEN c.hits + 1 > $3
               THEN now() + $4::double precision * interval '1 millisecond'
             ELSE NULL
           END
         RETURNING hits, expires_at, blocked_until`,
        [key, ttl, limit, blockDuration],
      );

    const row = rows[0]!;
    const now = Date.now();
    const blockedUntil = row.blocked_until === null ? null : new Date(row.blocked_until).getTime();
    const isBlocked = blockedUntil !== null && blockedUntil > now;
    return {
      totalHits: Number(row.hits),
      timeToExpire: Math.ceil((new Date(row.expires_at).getTime() - now) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil((blockedUntil - now) / 1000) : 0,
    };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx nx test backend -- postgres-throttler.storage`
Expected: PASS, eight cases.

- [ ] **Step 5: Prove the property a fake cannot — two connections, one counter**

A fake shares a process, so it can never demonstrate the thing this class exists for. Add to
`tests/integration/docker.test.mjs`, in the tier that has a real Postgres, a case that opens
**two independent connections** and drives the limit across both:

```js
test('the rate limiter counts across connections, not within one process', async () => {
  // Two pools, as two replicas would be. If the counter lived in a process,
  // each would permit the full budget and this assertion would fail.
  const a = newPool();
  const b = newPool();
  const key = `probe-${Date.now()}`;
  for (let i = 0; i < 3; i += 1) await incrementVia(a, key);
  for (let i = 0; i < 3; i += 1) await incrementVia(b, key);
  const { rows } = await a.query('SELECT hits FROM rate_limit_counters WHERE key = $1', [key]);
  assert.equal(Number(rows[0].hits), 6, 'six attempts across two connections count as six');
  await a.end();
  await b.end();
});
```

- [ ] **Step 6: Falsify it**

Change `hits = ... ELSE c.hits + 1` to `ELSE 1` and run both the unit spec and the docker
case. Confirm the limit tests fail and nothing unrelated does. Restore. Record in the task
report which tests went red — a storage whose counting can be broken without a red test is
the one failure this task cannot ship with.

- [ ] **Step 7: Commit**

```bash
git add template/apps/backend tests/integration/docker.test.mjs
git commit -m "feat(throttling): counters in Postgres, counted in one statement

Two processes arriving together cannot both read a stale count and both decide
they are under the limit — the second ON CONFLICT update sees the first one's
row. A read followed by a write would race exactly under the concurrency an
attacker is most likely to produce.

Units are not what the parameter names suggest: ttl and blockDuration arrive in
milliseconds, timeToExpire and timeToBlockExpire are returned in seconds. The
retry header is built from them, so milliseconds out would tell every refused
caller to wait a thousand times too long and fail nothing.

One deliberate difference from the bundled store — a fixed window rather than a
sliding one — documented on the class.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The guard's three adaptations, and the buckets

`ThrottlerGuard` is subclassed rather than replaced. Three overrides, each at a point the
library publishes:

- `getTracker` — the subject, never the network address.
- `throwThrottlingException` — `TooManyAttemptsError`, so the refusal reaches the filter.
- `shouldSkip` — true for any route without a `@Throttled` bucket, so adding a throttler
  does not silently meter every route in the application.

**Files:**
- Create: `template/apps/backend/src/throttling/throttling.config.ts`
- Create: `template/apps/backend/src/throttling/throttled.decorator.ts`
- Create: `template/apps/backend/src/throttling/forge-throttler.guard.ts`
- Create: `template/apps/backend/src/throttling/throttling.module.ts`
- Modify: `template/apps/backend/package.json`, `template/apps/backend/src/app.module.ts`
- Test: `template/apps/backend/src/throttling/__tests__/forge-throttler.guard.spec.ts`
- Test: `template/apps/backend/src/__tests__/composition-root.spec.ts`

**Interfaces:**
- Consumes: `TooManyAttemptsError` (Task 3), `PostgresThrottlerStorage` (Task 5).
- Produces: `Throttled(bucket: ThrottleBucket)` — a method decorator; `ThrottleBucket` is
  `'mfa-attempt' | 'mfa-mint' | 'mfa-proof' | 'credential' | 'reset-credential'`. Task 7 applies it.

- [ ] **Step 1: Add the dependency**

```bash
cd template/apps/backend && npm pkg set dependencies.@nestjs/throttler="^6.7.1" && cd -
```

- [ ] **Step 2: Write the buckets and the subject kinds**

`throttling.config.ts`:

```ts
import type { ConfigService } from '@nestjs/config';

/** Which budget a route draws on. */
export type ThrottleBucket =
  | 'mfa-attempt'
  | 'mfa-mint'
  | 'mfa-proof'
  | 'credential'
  | 'reset-credential';

/** Where a bucket's subject is found on the request. */
export enum ThrottleSubject {
  /** The challenge this attempt answers. */
  CHALLENGE = 'CHALLENGE',
  /** The signed-in account, or the challenge when there is no session yet. */
  ACCOUNT_OR_CHALLENGE = 'ACCOUNT_OR_CHALLENGE',
  /** The address the request named, whether or not it names anybody. */
  ADDRESS = 'ADDRESS',
  /** The single-use credential a reset presents. */
  RESET_CREDENTIAL = 'RESET_CREDENTIAL',
}

/** What each bucket counts against, and how generously. */
export interface BucketDefinition {
  readonly subject: ThrottleSubject;
  readonly limit: number;
  /** Window, in milliseconds — the unit the library's storage takes. */
  readonly ttl: number;
  /** How long a refusal lasts once the limit is passed, in milliseconds. */
  readonly blockDuration: number;
}

const MINUTE = 60_000;

/**
 * The budgets, with their defaults.
 *
 * Every number is an environment variable, because these are guesses until
 * somebody runs this in anger and the one most likely to be felt first is
 * `credential` — a shared address retrying a forgotten password is the
 * plausible false positive.
 *
 * **There is deliberately no switch that disables throttling.** A
 * deployment-wide "off" is a security control that fails silently the moment
 * somebody sets it and forgets, and a test that needs different numbers passes
 * them to {@link buildBuckets} directly.
 */
export function buildBuckets(config: ConfigService): Record<ThrottleBucket, BucketDefinition> {
  const num = (key: string, fallback: number): number => {
    const raw = config.get<string>(key);
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    // The window is the challenge's own lifetime, so the budget dies with the
    // challenge rather than outliving it.
    'mfa-attempt': {
      subject: ThrottleSubject.CHALLENGE,
      limit: num('THROTTLE_MFA_ATTEMPT_LIMIT', 5),
      ttl: 5 * MINUTE,
      blockDuration: 5 * MINUTE,
    },
    // Why this exists at all: a per-challenge cap resets whenever a new
    // challenge is minted, so an attacker holding the password would buy a
    // fresh budget on demand.
    'mfa-mint': {
      subject: ThrottleSubject.ACCOUNT_OR_CHALLENGE,
      limit: num('THROTTLE_MFA_MINT_LIMIT', 10),
      ttl: num('THROTTLE_MFA_MINT_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_MFA_MINT_WINDOW_MS', 15 * MINUTE),
    },
    'mfa-proof': {
      subject: ThrottleSubject.ACCOUNT_OR_CHALLENGE,
      limit: num('THROTTLE_MFA_PROOF_LIMIT', 10),
      ttl: num('THROTTLE_MFA_PROOF_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_MFA_PROOF_WINDOW_MS', 15 * MINUTE),
    },
    credential: {
      subject: ThrottleSubject.ADDRESS,
      limit: num('THROTTLE_CREDENTIAL_LIMIT', 10),
      ttl: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
    },
    // Its own bucket rather than a share of `credential`, because the request
    // carries no address to count against: a reset presents only the
    // single-use credential it is spending. That credential IS the thing being
    // guessed, so it is the right subject, and keeping it separate stops a
    // reset budget and a sign-in budget draining each other.
    'reset-credential': {
      subject: ThrottleSubject.RESET_CREDENTIAL,
      limit: num('THROTTLE_CREDENTIAL_LIMIT', 10),
      ttl: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
      blockDuration: num('THROTTLE_CREDENTIAL_WINDOW_MS', 15 * MINUTE),
    },
  };
}
```

- [ ] **Step 3: Write the decorator**

`throttled.decorator.ts`:

```ts
import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { ThrottleBucket } from './throttling.config';

/** Where the guard looks for the bucket a route draws on. */
export const THROTTLE_BUCKET = 'forge:throttle-bucket';

/**
 * Draws this route's attempts from `bucket`.
 *
 * One decorator rather than the library's own plus a second carrying the
 * subject: the limit and what it counts against are one decision, and a route
 * that had the numbers without the subject — or the reverse — would be
 * metering something nobody chose.
 *
 * A route without this decorator is not throttled. That is the guard's
 * `shouldSkip`, and it is deliberate: a global guard that metered every route
 * by default would meter them on whatever subject happened to be available,
 * which for most routes is nothing at all.
 */
export function Throttled(bucket: ThrottleBucket): MethodDecorator {
  return applyDecorators(SetMetadata(THROTTLE_BUCKET, bucket));
}
```

- [ ] **Step 4: Write the failing guard tests**

```ts
import { ExecutionContext } from '@nestjs/common';
import { TooManyAttemptsError } from '__FORGE_SCOPE__/core/shared/errors';
import { ForgeThrottlerGuard } from '../forge-throttler.guard';
import { ThrottleSubject } from '../throttling.config';

describe('ForgeThrottlerGuard', () => {
  describe('the subject it counts against', () => {
    it('never uses the network address', () => {
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, {
        ip: '203.0.113.9',
        body: { email: 'Person@Example.com' },
      });
      expect(tracker).not.toContain('203.0.113.9');
    });

    it('normalizes the address, so case is not a second bucket', () => {
      const upper = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, {
        body: { email: 'Person@Example.com' },
      });
      const lower = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, {
        body: { email: 'person@example.com' },
      });
      expect(upper).toBe(lower);
    });

    // Review Focus 1: the guard runs BEFORE the validation pipe, so the raw
    // body reaches it. None of these may throw, and none may collide with a
    // real subject.
    it.each([
      ['a missing body', {}],
      ['no email field', { body: {} }],
      ['a null email', { body: { email: null } }],
      ['an object where a string belongs', { body: { email: { toString: () => 'x' } } }],
      ['an array', { body: { email: ['a@b.c'] } }],
    ])('yields the malformed bucket for %s', (_label, request) => {
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, request);
      expect(typeof tracker).toBe('string');
      expect(tracker).toBe(ForgeThrottlerGuard.MALFORMED);
    });

    it('prefers the session over the challenge when both are present', () => {
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ACCOUNT_OR_CHALLENGE, {
        user: { userId: 'user-1' },
        body: { challengeToken: 'tok' },
      });
      expect(tracker).toContain('user-1');
    });
  });

  it('raises the domain error, not the library exception', async () => {
    const guard = new ForgeThrottlerGuard({ throttlers: [] }, {} as never, {} as never);
    await expect(
      guard['throwThrottlingException']({} as ExecutionContext, {
        timeToBlockExpire: 900,
      } as never),
    ).rejects.toBeInstanceOf(TooManyAttemptsError);
  });
});
```

- [ ] **Step 5: Run them and watch them fail**

Run: `npx nx test backend -- forge-throttler.guard`
Expected: FAIL — the guard does not exist.

- [ ] **Step 6: Write the guard**

```ts
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { TooManyAttemptsError } from '__FORGE_SCOPE__/core/shared/errors';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { THROTTLE_BUCKET } from './throttled.decorator';
import { ThrottleSubject, type ThrottleBucket } from './throttling.config';

/**
 * The framework's throttler, adapted in three places and replaced in none.
 *
 * ## The subject is never the network address
 *
 * The library's own tracker is the request's address. This application cannot
 * use it. Nothing configures a trusted proxy, and `auth/client-context.ts`
 * records that the address and the label it collects are never trusted for a
 * decision — so behind a proxy the observed address is the proxy's, identical
 * for every caller, and a budget keyed on it would meter the whole userbase as
 * one. Declaring the proxy trusted would make the address client-supplied,
 * which both defeats the budget and turns it into a way to deny service to
 * somebody else's account.
 *
 * What is counted instead is something the server minted or the attack targets.
 * **This does not cover an attacker spreading a few attempts across many
 * accounts from one host.** That needs a trustworthy network identity, which
 * this deployment does not have; it is stated here rather than half-covered,
 * because a budget that looks like it covers that case and does not is worse
 * than none.
 *
 * ## An address is counted whether or not it names anybody
 *
 * {@link ThrottleSubject.ADDRESS} is taken from the request, not from a lookup.
 * Counting only addresses that resolve to an account would make a refusal and a
 * rejection distinguishable, and the budget built to harden signing in would
 * become a way to ask whether somebody has an account here. ADR-0005: a
 * rejection reason is recorded, never returned on an authentication path.
 *
 * ## A route with no bucket is not throttled
 *
 * `shouldSkip` is true wherever `@Throttled` is absent. A global guard that
 * metered everything by default would meter each route on whatever subject
 * happened to be present, which for most of them is nothing.
 */
@Injectable()
export class ForgeThrottlerGuard extends ThrottlerGuard {
  /**
   * The subject every request that did not carry a usable one shares.
   *
   * They share a single budget rather than getting one each, which would grow
   * the table without bound, and rather than being refused, which would make a
   * malformed body a server error. Nothing legitimate is harmed: the guard runs
   * before validation, and a request with no subject is one the validation pipe
   * rejects a moment later anyway.
   */
  public static readonly MALFORMED = 'malformed';

  /** Reads a subject off the raw request. `public static` so a test can drive it directly. */
  public static subjectOf(subject: ThrottleSubject, request: Record<string, any>): string {
    const body: Record<string, unknown> = request['body'] ?? {};
    const text = (value: unknown): string | null =>
      typeof value === 'string' && value.length > 0 ? value : null;

    switch (subject) {
      case ThrottleSubject.CHALLENGE: {
        const token = text(body['challengeToken']);
        return token === null ? ForgeThrottlerGuard.MALFORMED : `challenge:${token}`;
      }
      case ThrottleSubject.ACCOUNT_OR_CHALLENGE: {
        const userId = text(request['user']?.['userId']);
        if (userId !== null) return `account:${userId}`;
        const token = text(body['challengeToken']);
        return token === null ? ForgeThrottlerGuard.MALFORMED : `challenge:${token}`;
      }
      case ThrottleSubject.ADDRESS: {
        const email = text(body['email']);
        // Normalized through core's own rule, so that one address is one
        // budget rather than one per spelling.
        return email === null ? ForgeThrottlerGuard.MALFORMED : `address:${normalizeEmail(email)}`;
      }
      case ThrottleSubject.RESET_CREDENTIAL: {
        const credential = text(body['credential']);
        return credential === null ? ForgeThrottlerGuard.MALFORMED : `reset:${credential}`;
      }
      default:
        return ForgeThrottlerGuard.MALFORMED;
    }
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    return this.bucketOf(context) === undefined;
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    // `getTracker` receives the request alone, so the bucket's subject kind is
    // stashed on it by `canActivate`'s path through `shouldSkip`. Read it back
    // here, defaulting to the shared bucket rather than throwing.
    const subject: ThrottleSubject | undefined = req['__forgeThrottleSubject'];
    return subject === undefined
      ? ForgeThrottlerGuard.MALFORMED
      : ForgeThrottlerGuard.subjectOf(subject, req);
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // The library's own exception would answer directly and bypass both
    // `HttpExceptionFilter`'s table and the translation it performs. Every
    // other failure in this application goes through there; this one does too.
    throw new TooManyAttemptsError(detail.timeToBlockExpire);
  }

  private bucketOf(context: ExecutionContext): ThrottleBucket | undefined {
    return this.reflector.getAllAndOverride<ThrottleBucket | undefined>(THROTTLE_BUCKET, [
      context.getHandler(),
      context.getClass(),
    ]);
  }
}
```

**Note for the implementer:** `getTracker` receives only the request, so the bucket's subject
kind must reach it. Resolve this by overriding `canActivate` to stash the resolved subject on
the request before delegating to `super.canActivate(context)` — do not reach for a module-level
mutable, which would be wrong under concurrency. Write the override, and write a test that two
interleaved requests with different buckets each get their own subject.

- [ ] **Step 7: Write the module and register it globally**

`throttling.module.ts` builds `ThrottlerModule.forRootAsync` from `buildBuckets`, binds
`ThrottlerStorage` to `PostgresThrottlerStorage`, and registers
`TypeOrmModule.forFeature([RateLimitCounterRecord])`.

In `app.module.ts`, add `ThrottlingModule` to `imports` and add to `GLOBAL_PROVIDERS`, above
the existing `JwtAuthGuard` entry:

```ts
  // Every route carrying `@Throttled` draws on its bucket. Deleting this line
  // breaks no type and fails no lint rule, which is why
  // `__tests__/composition-root.spec.ts` asserts it is here.
  { provide: APP_GUARD, useClass: ForgeThrottlerGuard },
```

- [ ] **Step 8: Assert the registration**

Add to `template/apps/backend/src/__tests__/composition-root.spec.ts`, in the style of the
existing assertions over `GLOBAL_PROVIDERS`:

```ts
  it('registers the throttler guard globally', () => {
    const guards = GLOBAL_PROVIDERS.filter(
      (provider) => typeof provider === 'object' && provider.provide === APP_GUARD,
    );
    expect(guards.map((g) => (g as { useClass: unknown }).useClass)).toContain(
      ForgeThrottlerGuard,
    );
  });
```

- [ ] **Step 9: Run the gates**

```bash
npx nx test backend && npx nx lint backend && npx nx typecheck backend && npm run sanitize
```

- [ ] **Step 10: Commit**

```bash
git add template/apps/backend
git commit -m "feat(throttling): the guard's three adaptations

getTracker returns a server-known subject, never the network address: nothing
configures a trusted proxy, so behind one the observed address is the proxy's
and a budget keyed on it would meter the whole userbase as one bucket.

An address is counted whether or not it names an account. Counting only the
ones that resolve would make a refusal and a rejection distinguishable, turning
the budget into a way to ask whether somebody has an account here.

throwThrottlingException raises the domain error so the refusal reaches the
filter's table and its translation, and shouldSkip means a route without
@Throttled is not metered on whatever subject happened to be lying around.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Apply the buckets, and prove each one is attached

**This task's payload is wiring, and wiring is what silently fails to be attached.** Phase 3's
rule, which cost a phase to learn: any wiring owes an assertion that fails when it is deleted,
plus the evidence of having watched it fail. One decorator, one test, per route — and the
removal of each decorator observed to turn exactly one test red.

**Files:**
- Modify: `template/apps/backend/src/auth/auth.controller.ts`
- Modify: `template/apps/backend/src/mfa/mfa.controller.ts`
- Test: `template/apps/backend/src/throttling/__tests__/throttled-routes.spec.ts`

**Interfaces:**
- Consumes: `Throttled` (Task 6).
- Produces: no new symbols. Every route in the table below carries a bucket.

- [ ] **Step 1: Write the attachment test first**

```ts
import { THROTTLE_BUCKET } from '../throttled.decorator';
import { AuthController } from '../../auth/auth.controller';
import { MfaController } from '../../mfa/mfa.controller';

/**
 * Every route that must draw on a budget, and which one.
 *
 * A table rather than a case each, because the thing being asserted is
 * identical per row and the risk is a row being absent — which a reader can
 * see here and cannot see spread across nine `it` blocks.
 */
const EXPECTED: ReadonlyArray<[unknown, string, string]> = [
  [AuthController, 'login', 'credential'],
  [AuthController, 'forgotPassword', 'credential'],
  [AuthController, 'resendVerification', 'credential'],
  [AuthController, 'resetPassword', 'reset-credential'],
  [AuthController, 'verifyMfa', 'mfa-attempt'],
  [AuthController, 'mfaMethods', 'mfa-mint'],
  [MfaController, 'enrollTotp', 'mfa-mint'],
  [MfaController, 'confirmTotp', 'mfa-proof'],
  [MfaController, 'regenerateRecoveryCodes', 'mfa-proof'],
  [MfaController, 'remove', 'mfa-proof'],
  [MfaController, 'webAuthnOptions', 'mfa-mint'],
  [MfaController, 'webAuthnVerify', 'mfa-attempt'],
];

describe('every route that spends a budget declares which one', () => {
  it.each(EXPECTED)('%p.%s draws on %s', (controller, method, bucket) => {
    const handler = (controller as { prototype: Record<string, unknown> }).prototype[method];
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(THROTTLE_BUCKET, handler as object)).toBe(bucket);
  });
});
```

**Correct the method names** against the controllers as they actually are — the table above
names them as this plan found them, and a name that has since changed must be fixed here
rather than worked around.

- [ ] **Step 2: Run it and watch every row fail**

Run: `npx nx test backend -- throttled-routes`
Expected: FAIL, twelve rows, each `undefined` rather than its bucket.

- [ ] **Step 3: Apply the decorators**

Add `@Throttled('<bucket>')` to each route named above, directly below its HTTP-method
decorator. Import `Throttled` from `../throttling/throttled.decorator` in both controllers.
Change nothing else — no signature, no body, no existing decorator.

- [ ] **Step 4: Run it and watch every row pass**

Run: `npx nx test backend -- throttled-routes`
Expected: PASS, twelve rows.

- [ ] **Step 5: Watch each one fail on its own**

For each row: delete that route's `@Throttled`, run the spec, confirm **exactly one** row goes
red, restore. Twelve removals, twelve single-row failures. Record the result in the task
report as a count, not as a claim that it was done.

This is tedious and it is the point. The failure this catches is a decorator that was never
added to one route out of twelve, which no reviewer reading a diff reliably sees and which no
other test in this repository would notice.

- [ ] **Step 6: Review Focus 4 — an unknown challenge must still be metered**

An attacker sending a token that names no challenge must spend budget. Otherwise the cheapest
attack is to send garbage, and the throttle only ever meters honest callers. Add to the same
spec:

```ts
  it('meters an attempt whose challenge does not exist', async () => {
    // The subject is the token as presented, not a challenge resolved from it,
    // so a token naming nothing is still a subject and still spends budget.
    const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.CHALLENGE, {
      body: { challengeToken: 'no-such-challenge' },
    });
    expect(tracker).toBe('challenge:no-such-challenge');
    expect(tracker).not.toBe(ForgeThrottlerGuard.MALFORMED);
  });
```

- [ ] **Step 7: Write the discriminating test, D16**

Create an end-to-end case driving a real application through `supertest`, in the style of the
existing controller specs: exhaust `mfa-attempt` against one challenge and assert the refusal
is a `429` carrying the translated message and the code `TOO_MANY_ATTEMPTS` — not the
library's own body, and not a `500`.

Add D16 to the discriminating-test table in
`docs/superpowers/specs/2026-09-17-forge-template-design.md` §11, matching the existing rows'
format: *"a subject that exhausts its budget is refused, and the refusal is the domain error
with its retry window."*

- [ ] **Step 8: Run the gates**

```bash
npx nx test backend && npx nx lint backend && npx nx typecheck backend && npm run sanitize
```

- [ ] **Step 9: Commit**

```bash
git add template/apps/backend docs/superpowers/specs
git commit -m "feat(throttling): twelve routes declare their budget, and each is pinned

The payload here is wiring, and wiring is what silently fails to be attached.
One table-driven assertion per route, and each decorator removed in turn to
watch exactly one row go red — the failure being guarded against is a decorator
missing from one route out of twelve, which no reviewer reliably sees in a diff.

A challenge token naming no challenge is still metered. Otherwise the cheapest
attack is to send garbage and the budget only ever meters honest callers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Audit the refusal, once per block

A refusal is security-relevant and belongs in the audit log. **Only the transition is
written** — the attempt that first blocks a subject, not every attempt refused afterwards.
Auditing each one would let an attacker write into `audit_entries` without bound simply by
continuing, turning a record into an amplifier.

**Files:**
- Modify: `template/libs/core/src/audit/enums/AuditAction.ts`
- Modify: `template/apps/backend/src/throttling/postgres-throttler.storage.ts`
- Modify: `template/apps/backend/src/throttling/throttling.module.ts`
- Test: `template/libs/core/tests/audit/enums/AuditAction.spec.ts`
- Test: `template/apps/backend/src/throttling/__tests__/postgres-throttler.storage.spec.ts`

**Interfaces:**
- Consumes: `PostgresThrottlerStorage` (Task 5), the audit writer the other services use.
- Produces: `AuditAction.THROTTLE_ENGAGED`.

- [ ] **Step 1: Add the enum member and its pinned value**

In `template/libs/core/src/audit/enums/AuditAction.ts`, add:

```ts
  /** A subject exceeded a budget and was refused. Written once per block, not once per refusal. */
  THROTTLE_ENGAGED = 'THROTTLE_ENGAGED',
```

Add the matching entry to the hand-written value map in the same file, and to the map's
test. Every member's string value is pinned by hand there; a member added without its entry
is what that map exists to catch.

- [ ] **Step 2: Return whether this call caused the block**

The storage's statement already knows: it is the call where `blocked_until` goes from absent
or past to future. Return it alongside the record so the caller need not compare twice.
Extend the returning clause and the method's result with an internal flag — the
`ThrottlerStorageRecord` shape is the library's and must not grow a field, so expose it as a
separate readonly property on the storage instance read immediately after the call, or as a
callback the module supplies. **Prefer the callback:** a property read after an `await` is a
race under concurrency, and this class is explicitly built for the multi-process case.

```ts
  public constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly onBlocked: (key: string, retryAfterSeconds: number) => void,
  ) {}
```

- [ ] **Step 3: Write the failing test**

```ts
  it('reports the block once, on the attempt that causes it', async () => {
    const blocked: string[] = [];
    const storage = await harnessWith((key) => blocked.push(key));
    for (let i = 0; i <= LIMIT + 3; i += 1) {
      await storage.increment('k', TTL, LIMIT, BLOCK, 'default');
    }
    expect(blocked).toEqual(['k']);
  });
```

That assertion is the whole point: `toEqual(['k'])` fails both if the block is never reported
and if it is reported on every refusal afterwards.

- [ ] **Step 4: Implement, and run**

Run: `npx nx test backend -- postgres-throttler.storage`
Expected: PASS.

- [ ] **Step 5: Wire the callback to the audit writer**

In `throttling.module.ts`, supply a callback that records `THROTTLE_ENGAGED` through the same
audit writer the rest of the backend uses. The entry carries the bucket and the retry window.
**It does not carry the subject verbatim** — an address or a challenge token written into an
audit row is a credential-adjacent value in a table built to be read; record a digest of it
through `hashOpaqueToken`, as every other stored token in this schema is.

- [ ] **Step 6: Run the gates**

```bash
npx nx test core && npx nx test backend && npx nx lint backend && npm run sanitize
```

- [ ] **Step 7: Commit**

```bash
git add template/libs/core template/apps/backend
git commit -m "feat(audit): record a throttle block once, not once per refusal

Auditing every refusal would let an attacker write into audit_entries without
bound by continuing to attempt, turning the record into an amplifier. Only the
transition is written.

The subject is hashed rather than stored: an address or a challenge token in a
table built to be read is a credential-adjacent value, and every other stored
token in this schema is a digest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `decideMfaEnrollment` — continuity of control

`decideMfaRemoval` demands a live proof only when a removal would leave **zero** confirmed
methods, and it reasons about the count of confirmed methods rather than about who controls
them. Enrolment asks for nothing but a live session. So a stolen session can enrol a second
factor of its own, confirm it, then delete the owner's — permitted, because a confirmed
method survives. The account still has a second factor, exactly as the policy's documentation
says, and it belongs to the attacker.

**Files:**
- Create: `template/libs/core/src/mfa/enums/MfaEnrollmentDecision.ts`
- Create: `template/libs/core/src/mfa/policies/decideMfaEnrollment.ts`
- Modify: `template/libs/core/src/mfa/enums/index.ts`, `template/libs/core/src/mfa/policies/index.ts`
- Modify: `template/libs/core/src/mfa/policies/decideMfaRemoval.ts` (documentation only)
- Test: `template/libs/core/tests/mfa/policies/decideMfaEnrollment.spec.ts`

**Interfaces:**
- Consumes: `MfaMethod` from `__FORGE_SCOPE__/core/mfa/entities`.
- Produces: `decideMfaEnrollment(methods: readonly MfaMethod[], validProofPresented: boolean): MfaEnrollmentDecision`
  and `enum MfaEnrollmentDecision { ALLOWED, REAUTHENTICATION_REQUIRED }`. Task 10 calls it.

- [ ] **Step 1: Write the failing tests**

```ts
import { MfaEnrollmentDecision } from '__FORGE_SCOPE__/core/mfa/enums';
import { decideMfaEnrollment } from '__FORGE_SCOPE__/core/mfa/policies';
// `confirmed()` / `unconfirmed()` are this suite's existing fixtures; follow
// `decideMfaRemoval.spec.ts` for how it builds them.

describe('decideMfaEnrollment', () => {
  it('allows the first factor, which has nothing to prove with', () => {
    expect(decideMfaEnrollment([], false)).toBe(MfaEnrollmentDecision.ALLOWED);
  });

  it('allows it when only unconfirmed methods exist', () => {
    // An unconfirmed method is no gate at all, so it cannot produce a proof.
    // Demanding one would make enrollment impossible for an account whose
    // first attempt was abandoned.
    expect(decideMfaEnrollment([unconfirmed()], false)).toBe(MfaEnrollmentDecision.ALLOWED);
  });

  it('demands a proof once a confirmed method exists', () => {
    expect(decideMfaEnrollment([confirmed()], false)).toBe(
      MfaEnrollmentDecision.REAUTHENTICATION_REQUIRED,
    );
  });

  it('allows it when that proof is presented', () => {
    expect(decideMfaEnrollment([confirmed()], true)).toBe(MfaEnrollmentDecision.ALLOWED);
  });

  it('is unmoved by how many confirmed methods there are', () => {
    expect(decideMfaEnrollment([confirmed(), confirmed(), confirmed()], false)).toBe(
      MfaEnrollmentDecision.REAUTHENTICATION_REQUIRED,
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx nx test core -- decideMfaEnrollment`
Expected: FAIL — not exported.

- [ ] **Step 3: Write the enum and the policy**

`MfaEnrollmentDecision.ts`:

```ts
/**
 * Whether confirming a second factor may proceed on the strength of the
 * requesting session alone.
 *
 * Modelled rather than left to whichever check a caller happens to run first,
 * for the reason {@link MfaRemovalDecision} is: adding a factor and removing
 * one are the two ways the set of things that can prove this account changes,
 * and a decision that exists for one and not the other is a gap shaped exactly
 * like the way around it.
 */
export enum MfaEnrollmentDecision {
  /** The session that asked is sufficient. */
  ALLOWED = 'ALLOWED',
  /** A live proof from a factor the account already holds must accompany the request. */
  REAUTHENTICATION_REQUIRED = 'REAUTHENTICATION_REQUIRED',
}
```

`decideMfaEnrollment.ts`:

```ts
import type { MfaMethod } from '../entities/MfaMethod';
import { MfaEnrollmentDecision } from '../enums/MfaEnrollmentDecision';

/**
 * Whether a factor may be confirmed on the strength of the requesting session
 * alone, or a live proof from a factor the account already holds must
 * accompany it.
 *
 * ## What this protects, and why counting was not enough
 *
 * {@link decideMfaRemoval} guarantees that the set of confirmed methods never
 * reaches zero without a live proof. That guarantee says nothing about *whose*
 * methods they are. A session that is not the owner's can add a factor of its
 * own, and once it has, removing the owner's leaves a confirmed method behind
 * and is permitted — so the account ends with a second factor the owner cannot
 * produce, and the removal guarantee never fires, because the count never
 * reaches zero.
 *
 * The property that actually matters is not how many confirmed methods an
 * account has but that control of them is continuous: every factor after the
 * first is admitted by a factor already trusted. This function is where that
 * is stated. With it, the set of methods an account holds can only ever be
 * extended by somebody who can already prove one of them.
 *
 * ## The first factor is free, and must be
 *
 * An account with no confirmed method has nothing to prove with. Demanding a
 * proof there would not be a stronger rule; it would be an account that can
 * never enrol anything — the same permanent-lockout failure
 * {@link decideMfaRemoval} already refuses for an unconfirmed method, arrived
 * at from the other direction. "Confirmed" is load-bearing in the sentence
 * above for exactly that reason: a method nobody has ever proven can produce a
 * valid response is no gate, so it cannot be the gate that admits the next one.
 *
 * Pure: no clock, no store, no I/O. Whether `validProofPresented` is true is
 * decided by the caller against whatever proof mechanism the existing methods
 * use; this function only decides what that boolean is allowed to unlock.
 *
 * @param methods - every method on record for the account, confirmed and unconfirmed alike
 * @param validProofPresented - whether a fresh proof from an already-confirmed method accompanies this request
 * @returns `ALLOWED` when the account holds no confirmed method, or holds one
 *   and a fresh proof was presented; otherwise `REAUTHENTICATION_REQUIRED`
 */
export function decideMfaEnrollment(
  methods: readonly MfaMethod[],
  validProofPresented: boolean,
): MfaEnrollmentDecision {
  const hasConfirmed = methods.some((method) => method.isConfirmed());
  if (!hasConfirmed) return MfaEnrollmentDecision.ALLOWED;
  return validProofPresented
    ? MfaEnrollmentDecision.ALLOWED
    : MfaEnrollmentDecision.REAUTHENTICATION_REQUIRED;
}
```

Add both to their barrels.

- [ ] **Step 4: Amend `decideMfaRemoval`'s documentation**

Its present argument reasons from a count — *"the account still requires a second factor
afterward, just not that particular one"* — which is true and is not the property that holds.
Replace that clause with one naming the invariant and the policy that now supplies it:

```
 * Removing *one of several* remaining confirmed methods is permitted on the
 * session alone. What makes that safe is not the count but continuity of
 * control: {@link decideMfaEnrollment} admits a new factor only on a proof
 * from one the account already holds, so every confirmed method on an account
 * traces back to the first. Without that rule this decision would be
 * sufficient to count and insufficient to protect — a session that is not the
 * owner's could add its own factor and then remove theirs, and the account
 * would still hold a confirmed method, which is all this function checks.
```

- [ ] **Step 5: Run the core gates**

```bash
npx nx test core && npm run purity -w libs/core && npx nx typecheck core && npx nx lint core
```

- [ ] **Step 6: Commit**

```bash
git add template/libs/core
git commit -m "feat(core): continuity of control, stated as a policy

decideMfaRemoval guarantees the set of confirmed methods never reaches zero
without a proof. It says nothing about whose they are: a session that is not
the owner's can add a factor of its own, and removing the owner's then leaves a
confirmed method behind and is permitted. The guarantee never fires because the
count never reaches zero.

decideMfaEnrollment states the property that matters — every factor after the
first is admitted by one already trusted — and decideMfaRemoval's TSDoc is
amended, because it argued from a count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Enforce the enrolment proof

`decideMfaEnrollment` decides; this wires it. The proof shape already exists —
`POST /mfa/recovery-codes` takes one, and `MfaProofDto` and `proofOf` are its vocabulary —
so this adds an optional proof to confirmation rather than inventing a second kind.

**Files:**
- Modify: `template/apps/backend/src/mfa/dto/confirm-totp.dto.ts`
- Modify: `template/apps/backend/src/mfa/mfa.controller.ts` (`confirmTotp`)
- Modify: `template/apps/backend/src/mfa/mfa.service.ts` (`confirmTotpEnrollment`)
- Modify: `template/apps/backend/src/mfa/webauthn/WebAuthnCeremonies.ts` (the enrolment leg)
- Test: `template/apps/backend/src/mfa/__tests__/mfa.service.spec.ts`

**Interfaces:**
- Consumes: `decideMfaEnrollment`, `MfaEnrollmentDecision` (Task 9); `MfaReauthenticationRequiredError` (existing).
- Produces: `confirmTotpEnrollment(userId, methodId, code, proof: MfaProof | null)` — one
  added parameter. The route answers `403 MFA_REAUTHENTICATION_REQUIRED` when a proof is owed.

- [ ] **Step 1: Write the failing tests**

```ts
  it('confirms the first factor with no proof', async () => {
    await expect(service.confirmTotpEnrollment(user, firstMethod, validCode, null)).resolves
      .toBeDefined();
  });

  it('refuses a second factor without a proof', async () => {
    await givenAConfirmedMethod(user);
    await expect(
      service.confirmTotpEnrollment(user, secondMethod, validCode, null),
    ).rejects.toBeInstanceOf(MfaReauthenticationRequiredError);
  });

  it('confirms a second factor when a proof from the first accompanies it', async () => {
    await givenAConfirmedMethod(user);
    await expect(
      service.confirmTotpEnrollment(user, secondMethod, validCode, proofFromFirst),
    ).resolves.toBeDefined();
  });

  // The escalation this closes, end to end.
  it('stops a session adding a factor and then removing the owner-s', async () => {
    await givenAConfirmedMethod(user);
    await expect(
      service.confirmTotpEnrollment(user, attackerMethod, validCode, null),
    ).rejects.toBeInstanceOf(MfaReauthenticationRequiredError);
  });
```

- [ ] **Step 2: Run them and watch the last three fail**

Run: `npx nx test backend -- mfa.service`
Expected: FAIL on the three that expect a refusal — confirmation currently asks for nothing.

- [ ] **Step 3: Implement**

Add the optional proof to `ConfirmTotpDto` using the same validators `MfaProofDto` uses. In
`confirmTotpEnrollment`, load the account's methods, verify the proof when one is offered —
through the same verifier `regenerateRecoveryCodes` uses, so there is one answer to "is this
proof good" rather than two — and consult `decideMfaEnrollment`. Throw
`MfaReauthenticationRequiredError` on `REAUTHENTICATION_REQUIRED`.

Do the same for the WebAuthn enrolment leg in `WebAuthnCeremonies`, which is the other way a
factor becomes confirmed. **A rule enforced on one of the two ways in is not enforced.**

- [ ] **Step 4: Run, then falsify**

Run `npx nx test backend -- mfa` and confirm green. Then delete the
`decideMfaEnrollment` consultation, confirm exactly the three refusal tests go red for each of
the two enrolment paths, and restore.

- [ ] **Step 5: Run the gates and commit**

```bash
npx nx test backend && npx nx lint backend && npx nx typecheck backend && npm run sanitize
git add template/apps/backend
git commit -m "feat(mfa): a second factor is admitted only by a factor already trusted

Enrollment asked for nothing but a live session, so a stolen session could
enroll its own factor, confirm it, and then delete the owner's — permitted,
because a confirmed method survived. Both ways a factor becomes confirmed now
consult decideMfaEnrollment; a rule enforced on one of two paths in is not
enforced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: A bound on enrolled methods

Nothing limits how many factors an account may enrol. Unbounded rows per account, written by
a caller who only needs a session.

**Files:** `template/apps/backend/src/mfa/mfa.service.ts`,
`template/libs/core/src/mfa/errors/TooManyMfaMethodsError.ts` and its barrel,
`http-exception.filter.ts`, `i18n/en/errors.json`, and the service spec.

- [ ] **Step 1: Write the failing test**

```ts
  it('refuses enrollment past the bound', async () => {
    for (let i = 0; i < MAX_MFA_METHODS; i += 1) await service.beginTotpEnrollment(user, `k${i}`);
    await expect(service.beginTotpEnrollment(user, 'one too many')).rejects.toBeInstanceOf(
      TooManyMfaMethodsError,
    );
  });

  it('counts unconfirmed methods toward the bound', async () => {
    // Abandoned enrollments are rows too, and an attacker who only needs a
    // session can create them without ever confirming one.
    for (let i = 0; i < MAX_MFA_METHODS; i += 1) await service.beginTotpEnrollment(user, `k${i}`);
    await expect(service.beginTotpEnrollment(user, 'another')).rejects.toBeInstanceOf(
      TooManyMfaMethodsError,
    );
  });
```

- [ ] **Step 2: Implement**

`export const MAX_MFA_METHODS = 8;` beside the service, with a comment saying what the number
is for: a person with a phone, a laptop, two keys and a spare has five, so eight is generous
for a human and still a bound. Count **all** methods, confirmed and not. Add
`TooManyMfaMethodsError` to core's `mfa/errors/`, the filter table (`CONFLICT`), and a
translation key.

- [ ] **Step 3: Run the gates and commit**

```bash
npx nx test core && npx nx test backend && npm run sanitize
git add template/libs/core template/apps/backend
git commit -m "feat(mfa): bound how many factors an account may enroll

Unconfirmed methods count: an abandoned enrollment is a row, and a caller
holding only a session could create them without ever confirming one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `loginOptions` stops rolling the challenge forward

Each WebAuthn login ceremony consumes a challenge and mints a fresh one with a full time to
live, so a caller can hold one open indefinitely by asking for options repeatedly. The expiry
should be carried forward from the challenge being replaced.

**Files:** `template/apps/backend/src/mfa/mfa-challenge.service.ts` (the `mint` signature),
`template/apps/backend/src/mfa/webauthn/WebAuthnCeremonies.ts:466`, and both specs.

- [ ] **Step 1: Write the failing test**

```ts
  it('does not extend the challenge-s life across ceremonies', async () => {
    const first = await ceremonies.loginOptions(/* ... */);
    const firstExpiry = await expiryOf(first.challengeToken);
    await advance(60_000);
    const second = await ceremonies.loginOptions(/* ... */);
    const secondExpiry = await expiryOf(second.challengeToken);
    expect(secondExpiry.getTime()).toBe(firstExpiry.getTime());
  });
```

- [ ] **Step 2: Implement**

Give `mint` an optional `expiresAt` that, when supplied, is used instead of
`now + MFA_CHALLENGE_TTL_MS`. Pass the consumed challenge's expiry from `loginOptions`.
Document on `mint` that the parameter exists so a ceremony that replaces a challenge cannot
extend the window the original opened — stating the invariant, not the call sites.

- [ ] **Step 3: Run the gates and commit**

```bash
npx nx test backend && npm run sanitize
git add template/apps/backend
git commit -m "fix(mfa): a replacement challenge inherits the original-s expiry

Each ceremony minted a fresh challenge with a full TTL, so asking for options
repeatedly held one open for as long as the caller liked.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Recovery codes a person can transcribe

`base64url` is a poor alphabet for the one credential this system expects somebody to copy by
hand from paper on a bad day. Crockford base32 excludes `I`, `L`, `O` and `U` — the first
three because they are read as `1`, `1` and `0`, and the last to avoid accidental words.

**Files:** `template/apps/backend/src/mfa/recovery/recovery-codes.ts`, and its spec.

- [ ] **Step 1: Write the failing tests**

```ts
  it('draws only from the transcribable alphabet', async () => {
    const codes = await recovery.generate(user);
    for (const code of codes) expect(code.replace(/\s+/g, '')).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('keeps at least 128 bits of entropy', async () => {
    const codes = await recovery.generate(user);
    // 26 characters of a 32-symbol alphabet is 130 bits.
    expect(codes[0]!.replace(/\s+/g, '').length).toBeGreaterThanOrEqual(26);
  });

  it('accepts a code typed in lower case', async () => {
    const [code] = await recovery.generate(user);
    await expect(recovery.consume(user, code!.toLowerCase())).resolves.toBeUndefined();
  });

  it('accepts the digits a person is likely to type for the excluded letters', async () => {
    const [code] = await recovery.generate(user);
    await expect(recovery.consume(user, code!.replace(/0/g, 'O'))).resolves.toBeUndefined();
  });
```

The last two are the point of the change. An alphabet chosen for transcription that then
refuses the transcription errors it was chosen to tolerate has bought nothing.

- [ ] **Step 2: Implement**

Encode `randomBytes(CODE_BYTES)` in Crockford base32 rather than `base64url`. Extend the
normalisation in `consume` — today `code.replace(/\s+/g, '')` — to upper-case and to fold
`O`→`0`, `I`/`L`→`1`, which is Crockford's own decoding rule. Keep the grouping. Keep
`hashOpaqueToken`; nothing about the digest changes.

**Normalise before hashing, in one place.** `generate` and `consume` must agree, and they
agree by calling the same function rather than by both being written correctly.

- [ ] **Step 3: Run the gates and commit**

```bash
npx nx test backend && npm run sanitize
git add template/apps/backend
git commit -m "feat(mfa): recovery codes in an alphabet a person can transcribe

base64url for the one credential somebody copies by hand from paper. Crockford
base32 drops I, L, O and U, and consume folds the substitutions a person
actually makes — an alphabet chosen for transcription that refuses the
transcription errors it was chosen to tolerate has bought nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Say how many recovery codes remain

Nobody is told. A person cannot know they are on their last one until it fails.

`GET /mfa/methods` currently returns `MfaMethodJSON[]`. A count is a property of the account,
not of a method, and `MfaMethodJSON`'s conformance suite asserts its key set exactly — so the
count must not go on it. The response becomes an envelope.

**Files:** `template/apps/backend/src/mfa/mfa.controller.ts` (`list`),
`template/apps/backend/src/mfa/mfa.service.ts`,
`template/apps/backend/src/mfa/dto/`, `template/apps/webapp/app/fetchers/`,
`template/apps/webapp/app/services/`, `template/apps/webapp/app/pages/account/security.vue`,
and the specs on both sides.

**Interfaces:**
- Produces: `GET /mfa/methods` → `{ methods: MfaMethodJSON[]; recoveryCodesRemaining: number }`.
  This is a breaking wire change; the webapp half of this task is not optional.

- [ ] **Step 1: Write the failing backend test**

```ts
  it('reports how many unconsumed recovery codes remain', async () => {
    await givenARecoveryBatch(user); // ten
    await consumeOne(user);
    const body = await get('/mfa/methods');
    expect(body.recoveryCodesRemaining).toBe(9);
  });

  it('reports zero rather than omitting the count', async () => {
    const body = await get('/mfa/methods');
    expect(body.recoveryCodesRemaining).toBe(0);
  });
```

The second case matters: an absent field and a zero are the same thing to a template that
renders `v-if`, and zero remaining is exactly when a person most needs to be told.

- [ ] **Step 2: Implement the backend**

Count rows in `mfa_recovery_codes` for the account with `consumedAt IS NULL`. Return the
envelope.

- [ ] **Step 3: Update the webapp**

Change the fetcher and service to the envelope shape, and show the count on the security
screen. **Warn when it is low** — at or below three — because a count nobody reads is the
same as no count. Follow the page's existing component vocabulary rather than introducing a
new one.

- [ ] **Step 4: Write the webapp test**

```ts
  it('warns when few codes remain', async () => {
    const screen = await renderSecurity({ recoveryCodesRemaining: 2 });
    expect(screen.html()).toContain('2');
    expect(screen.find('[data-test="recovery-codes-low"]').exists()).toBe(true);
  });
```

- [ ] **Step 5: Run every gate and commit**

```bash
npx nx test backend && npx nx test webapp && npx nx lint backend && npx nx lint webapp && npx nx typecheck backend && npm run sanitize
git add template
git commit -m "feat(mfa): say how many recovery codes remain, and warn when few do

A person could not tell they were on their last one until it failed. The count
is a property of the account rather than of a method, and MfaMethodJSON-s
conformance suite asserts its key set exactly, so the response becomes an
envelope — a breaking wire change, with the webapp half in the same commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final gates

Run before the whole-branch review, on a project generated into a scratch directory — the
template is tokenised and cannot be installed in place:

```bash
npm test                                    # the generator-s own suite
npm run sanitize                            # the extraction gate
npx nx run-many -t test lint typecheck      # in the generated project
FORGE_E2E=1 npm test                        # the docker tier, including the two-connection case
```

Measure Docker headroom with `docker run --rm alpine df -h /` before the e2e tier. Never stop,
remove or reconfigure a container this work did not create.
