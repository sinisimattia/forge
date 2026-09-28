# Forge Phase 5 — MFA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person can enroll TOTP or WebAuthn as a second factor, and from the moment they confirm one, no path in the system issues them a session without it.

**Architecture:** A new `mfa` domain in `libs/core` holds `MfaMethod` (no secret material) and two pure policies. `AuthenticationOutcome` gains an `MFA_REQUIRED` **variant**. The backend adds three tables and mints a single-use `mfa_challenges` row — Phase 4's `oauth_authorization_requests` machinery, second implementation — whose purpose is fixed by the endpoint that minted it and read with explicit per-value equality and a refusing fallthrough. Both the password path and the federated path consult the same policy, so neither can issue a session the other would have gated.

**Tech Stack:** TypeScript, NestJS 11, TypeORM 0.3, Postgres, Nuxt 4 / Vue 3, jest (backend), vitest (webapp/core), `otplib`, `@simplewebauthn/server`, `@simplewebauthn/browser`, `qrcode`.

**Spec:** `docs/superpowers/specs/2026-09-28-forge-phase-5-mfa-design.md` — read it first. Its parent is `docs/superpowers/specs/2026-09-17-forge-template-design.md` §9.3, §9.7, §9.8, §13 (D10).

**Prior art you must read before your first task:** `docs/superpowers/phase-4-decision-log.md`'s opening six, and `docs/superpowers/phase-roadmap.md` § "What Phase 5 must not get wrong". They are not background: every one of them names a defect this phase is positioned to repeat.

---

## Global Constraints

Every task's requirements implicitly include all of these. Exact values, copied verbatim.

1. **`~/Progetti/Voku` is read-only. Always.** Never write to it; never run a command there that could change tracked or untracked state. Before and after any task, `git -C ~/Progetti/Voku status --porcelain` must be empty and `git -C ~/Progetti/Voku rev-parse HEAD` must still be `fdfdbdeae2891954dd1cac538a082d5837f281dd`.
2. **This machine runs unrelated live Docker containers (a Postgres on 5432 among them). Never stop, remove or reconfigure a container you did not create.** Build cache and images are fair game; the user's containers and volumes are not.
3. **`npm run sanitize` must pass before any commit that touches `template/`.** Do not weaken a rule to make a commit pass.
4. **The generator takes no dependencies.** `tools/create/` and `tests/` use Node builtins only, tested with `node --test`. Forge's root `package.json` has no `dependencies` and no `devDependencies`. The four new packages go in `template/apps/backend/package.json` and `template/apps/webapp/package.json` only.
5. **Never add a foreign key to `audit_entries`**, in either direction. A referential action runs with the table owner's privileges and voids D13.
6. **`libs/core` stays framework-agnostic and transport-free, in prose as well as imports.** `grep -riE "\bjwt\b|cookie|http" template/libs/core/src` must return zero hits (D14). Never name a consuming app or framework in a comment or TSDoc there either.
7. **Docker headroom is checked with `docker run --rm alpine df -h /`, never `docker system df`.** Floor is 3 GB before starting any compose build.
8. **Probe cleanup form:** `PROBE_ROOT=$(mktemp -d)`, `PROBE="$PROBE_ROOT/probe"`, clean up with `rm -rf "$PROBE_ROOT"` — the directory you created, named directly. Never a path derived from another by taking its parent, and never `$TMPDIR`.
9. **Every new `AuditAction` member is added to the hand-written pinning map** in `template/libs/core/tests/audit/enums/AuditAction.spec.ts`. That map is transcribed, never derived. A failure there is the guard working.
10. **`AuthenticationStatus` members and `AuthenticationOutcome` variants are added together.** A bare enum member adds no variant, so `assertNever` still receives `never` and the exhaustiveness injection fails nothing, anywhere.
11. **On a security branch the safe default is refuse, not proceed.** Every dispatch on a value the database does not constrain uses explicit equality per modelled value and an unconditional refusing fallthrough. Never a ternary, never a default that proceeds.
12. **Derive every expectation from the requirement, and write the test before the code.** A test written to match code already written asserts the code, not the requirement — and it passes, which is what makes it worse than no test.
13. **Every assertion in this plan must be observed to fail** when its fault is injected, and the report says what was observed. A green suite is not evidence.
14. **Commit messages end with:**
    ```
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    ```

## Review Focus

Five failure modes the spec implies and no task's happy path would exercise. Each has a test, in the task that owns the code. Most likely to bite first.

1. **A federated sign-in bypasses MFA entirely.** An account with a confirmed TOTP method *and* a Google identity signs in through `GET /auth/oauth/google/callback`. `decideFederatedSignIn` returns `SIGN_IN_EXISTING`, `OAuthService.completeSignIn` calls `sessions.begin`, and a session exists — **second factor never consulted**. The spec is silent on this path, which is exactly why it would ship. Expected: every path that issues a session consults `decideAuthenticationStep` first, and the federated one refuses just as the password one does. → **Task 10**, and see the spec-amendment note below.
2. **A challenge token for user A presented with a `methodId` belonging to user B.** If the method is looked up by id alone, an attacker who holds any TOTP secret of their own completes anybody's second factor. Expected: the method lookup is scoped by the challenge row's `user_id`, and a method belonging to another user is indistinguishable from one that does not exist. → **Task 9**.
3. **The only enrolled method is unconfirmed.** Somebody started a TOTP enrollment, scanned nothing, and closed the tab. If an unconfirmed method gates login, that person is now locked out of their own account by an enrollment they never completed. Expected: `decideAuthenticationStep` counts confirmed methods only, and a user whose sole method has `confirmedAt === null` signs in normally. → **Task 3**.
4. **The same TOTP code presented twice inside its own 30-second window.** A code observed over the shoulder, or replayed from a proxy, is valid for the remainder of its step. Expected: the second presentation is refused because `totp_last_step` is not strictly less than the presented step. → **Task 8**.
5. **The same challenge token presented twice concurrently.** A double-clicked button or a retried request sends two verifications for one challenge. Expected: exactly one session exists afterwards — the row is consumed under a pessimistic write lock inside the transaction that reads it, so the second presentation finds it consumed and refuses. → **Task 6**.

> **Spec amendment owed.** Finding 1 above is a gap in
> `2026-09-28-forge-phase-5-mfa-design.md`, not just in the code: §8 describes
> two-phase login as a property of `POST /auth/login` and never mentions the
> federated path, so an implementer following the spec faithfully would ship the
> bypass. **Task 10 closes it, and Task 10 Step 1 amends the spec** before any
> code is written. Do not treat the spec as correct on this point.

---

## File Structure

### `template/libs/core/src/mfa/` — new domain, no secrets, no transport

| File | Responsibility |
|---|---|
| `entities/MfaMethod.ts` | One enrolled factor. Holds `id`, `userId`, `type`, `label`, `createdAt`, `confirmedAt`, `lastUsedAt` — and no secret material, exactly as `AuthIdentity` holds none. |
| `enums/MfaMethodType.ts` | `TOTP` \| `WEBAUTHN`. Both members from the start. |
| `enums/MfaStep.ts` | `ISSUE_SESSION` \| `REQUIRE_SECOND_FACTOR` — the discriminant of `decideAuthenticationStep`'s return. |
| `enums/MfaRemovalDecision.ts` | `ALLOWED` \| `REAUTHENTICATION_REQUIRED`. |
| `types/MfaMethodId.ts` | Branded id, following `AuthIdentityId`. |
| `types/MfaMethodProps.ts`, `types/MfaMethodJSON.ts` | Constructor input and wire shape. |
| `types/AuthenticationStepDecision.ts` | The discriminated union `decideAuthenticationStep` returns. |
| `contracts/IMfaService.ts` | The port. Returns domain shapes, throws domain errors, never sees a token. |
| `policies/decideAuthenticationStep.ts` | Whether a session may be issued. **D10 lives on the other side of this function.** |
| `policies/decideMfaRemoval.ts` | Whether removing a method needs a fresh proof. |
| `errors/*.ts` | Ten `DomainError` subclasses, one per file — spec §3.4's nine, plus `MfaLabelRequiredError` for the entity's own invariant. |
| `testing/*.ts` | The `IMfaService` conformance suite. |

### `template/apps/backend/src/mfa/` — the implementation and its transport

| File | Responsibility |
|---|---|
| `mfa.module.ts` | Wiring. |
| `mfa.service.ts` | Enrollment, confirmation, removal, recovery codes. |
| `mfa.controller.ts` | `/mfa/*` routes, all authenticated. |
| `mfa-challenge.service.ts` | Minting, hashing, write-locked consumption, the sweep, and the purpose refusal. Nothing else reads `mfa_challenges`. |
| `entities/mfa-method-record.entity.ts` | `mfa_methods`. |
| `entities/mfa-recovery-code-record.entity.ts` | `mfa_recovery_codes`. |
| `entities/mfa-challenge-record.entity.ts` | `mfa_challenges`. |
| `enums/MfaChallengePurpose.ts` | `LOGIN` \| `WEBAUTHN_ENROLLMENT`. Backend-only: a purpose is transport vocabulary, by ADR-0008's amended "where a port lives" test. |
| `mapMfaMethodRecord.ts` | Record → domain. **Refuses a row whose type and material disagree.** |
| `totp/TotpVerifier.ts` | `otplib` behind one function, plus the step-replay refusal. |
| `totp/totp-enrollment.ts` | Secret generation, `otpauth://` URI, QR SVG. |
| `webauthn/webauthn.config.ts` | RP ID and origin, with the boot refusal. |
| `webauthn/WebAuthnCeremonies.ts` | `@simplewebauthn/server` behind one façade. |
| `recovery/recovery-codes.ts` | Generation, hashing via `hashOpaqueToken`, single-use consumption. |
| `db/migrations/1758000005000-Mfa.ts` | The three tables. |

### `template/apps/webapp/app/` — the client half

| File | Responsibility |
|---|---|
| `pages/mfa/challenge.vue` | The second phase. Five refusals, each with a message and a remedy. |
| `pages/account/security.vue` | *Modified* — methods, enrollment, removal, recovery codes. |
| `components/MfaChallengeForm.vue`, `components/MfaMethodList.vue`, `components/TotpEnrollment.vue` | With stories. |
| `composables/useMfa.ts` | |
| `services/mfa.service.ts`, `services/mfa.fetchers.ts` | Over the wire, driven by the same conformance suite. |
| `stores/auth.ts` | *Modified* — learns `MFA_REQUIRED`; holds the challenge token **in memory only**. |

---

### Task 1: The flaking 401s — investigate before trusting the suite

**No MFA code in this task.** Three backend specs flake intermittently and all three present as spurious 401s. One of them is a discriminating security test, and this is a phase about whether sessions get issued: the suite that will judge every later task has to mean something first.

**Files:**
- Investigate: `template/apps/backend/src/__tests__/discriminating/d9-tenant-isolation.spec.ts`, `template/apps/backend/src/auth/__tests__/change-password.spec.ts`, `template/apps/backend/src/organizations/__tests__/members.controller.spec.ts`
- Likely suspects: `template/apps/backend/src/common/testing/tenancy-world.ts`, `template/apps/backend/jest.config.*`
- Record: `docs/superpowers/phase-5-decision-log.md` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing in code. Produces a **finding** every later task depends on: whether a green backend suite is evidence.

**Run cap: 30 minutes of wall clock, or 20 suite runs, whichever comes first.** If the cause is not found inside the cap, write down what was *eliminated* and proceed. A list of eliminated hypotheses is a real deliverable; an open-ended hunt is not.

- [ ] **Step 1: Reproduce, and measure the rate**

```bash
cd template/apps/backend
for i in $(seq 1 10); do
  npx cross-env NODE_ENV=test npx jest src/__tests__/discriminating/d9-tenant-isolation.spec.ts \
    src/auth/__tests__/change-password.spec.ts \
    --silent 2>&1 | tail -3
done
```

Record the failure rate. If it is 0/10, raise worker count (`--maxWorkers=4`) and repeat — the hypothesis under test is *shared session state across parallel jest workers*, which a serial run will not show.

- [ ] **Step 2: Test the shared-state hypothesis directly**

Run the same specs with `--runInBand`. If the flake disappears entirely under serial execution, the cause is shared state, not any one spec.

```bash
npx cross-env NODE_ENV=test npx jest src/__tests__/discriminating/d9-tenant-isolation.spec.ts src/auth/__tests__/change-password.spec.ts src/organizations/__tests__/members.controller.spec.ts --runInBand
```

- [ ] **Step 3: Find what is shared**

Read `src/common/testing/tenancy-world.ts`. Look specifically for: a module-level mutable binding; a fixed email or subject id reused across specs so two workers register the *same* account; a `JWT_SECRET` or signing key regenerated per worker so a token minted by one worker is invalid to another. The last of these produces exactly a spurious 401 and is the leading hypothesis — confirm or eliminate it.

- [ ] **Step 4: Fix, or document the elimination**

If found: fix it, then prove the fix by running Step 1's loop 10 times with 0 failures. If not found inside the cap: write the eliminated hypotheses into the decision log and move on.

- [ ] **Step 5: Record the finding**

Create `docs/superpowers/phase-5-decision-log.md` with a first section: what was measured, what was eliminated, what was fixed, and — stated plainly — **whether a green backend suite is now evidence for a security property.** Every later task's reviewer reads this answer.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
fix(tests): the three specs flaking as spurious 401s

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: The core domain — `MfaMethod`, its enums, its types, its errors

**Files:**
- Create: `template/libs/core/src/mfa/entities/MfaMethod.ts`, `entities/index.ts`
- Create: `template/libs/core/src/mfa/enums/{MfaMethodType,MfaStep,MfaRemovalDecision,index}.ts`
- Create: `template/libs/core/src/mfa/types/{MfaMethodId,MfaMethodProps,MfaMethodJSON,index}.ts`
- Create: `template/libs/core/src/mfa/errors/` — ten files plus `index.ts`
- Modify: `template/libs/core/package.json` (the `./mfa/*` export subpaths, following `./identities/*`)
- Test: `template/libs/core/tests/mfa/entities/MfaMethod.spec.ts`

**Interfaces:**
- Consumes: `UserId` from `../../users/types/UserId`; `Brand` from `../../shared/types/Brand`; `DomainError` from `../../shared/errors/DomainError`.
- Produces: `MfaMethod`, `MfaMethodId`, `MfaMethodProps`, `MfaMethodJSON`, `MfaMethodType`, `MfaStep`, `MfaRemovalDecision`, and the ten errors. Tasks 3, 5, 6, 8–14 all consume these names.

**Read first:** `template/libs/core/src/identities/entities/AuthIdentity.ts`. `MfaMethod` follows it in structure, in TSDoc voice, and above all in what it refuses to hold.

- [ ] **Step 1: Write the failing test**

```ts
// template/libs/core/tests/mfa/entities/MfaMethod.spec.ts
import { describe, expect, it } from 'vitest';
import { MfaMethod } from '../../../src/mfa/entities/MfaMethod';
import { MfaMethodType } from '../../../src/mfa/enums/MfaMethodType';
import { MfaLabelRequiredError } from '../../../src/mfa/errors/MfaLabelRequiredError';
import type { MfaMethodId } from '../../../src/mfa/types/MfaMethodId';
import type { UserId } from '../../../src/users/types/UserId';

const base = {
  id: 'm-1' as MfaMethodId,
  userId: 'u-1' as UserId,
  type: MfaMethodType.TOTP,
  label: 'Phone',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  confirmedAt: null,
  lastUsedAt: null,
};

describe('MfaMethod', () => {
  it('trims the label and keeps the six facts it is given', () => {
    const method = new MfaMethod({ ...base, label: '  Phone  ' });
    expect(method.label).toBe('Phone');
    expect(method.type).toBe(MfaMethodType.TOTP);
    expect(method.confirmedAt).toBeNull();
  });

  it('refuses a label that is absent or only whitespace', () => {
    expect(() => new MfaMethod({ ...base, label: '   ' })).toThrow(MfaLabelRequiredError);
  });

  it('is unconfirmed until it has an instant', () => {
    expect(new MfaMethod(base).isConfirmed()).toBe(false);
    expect(new MfaMethod({ ...base, confirmedAt: new Date() }).isConfirmed()).toBe(true);
  });

  // The property the whole entity exists to have. Derived from the requirement
  // (spec §3.1), not from the implementation: this assertion was written before
  // MfaMethod.ts existed, and it is what stops a later "just add the secret here"
  // from being a one-line change nobody notices.
  it('has no field that could hold secret material, in any serialization', () => {
    const json = JSON.stringify(new MfaMethod({ ...base, confirmedAt: new Date() }).toJSON());
    for (const forbidden of ['secret', 'publicKey', 'privateKey', 'credential', 'seed', 'counter']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(new MfaMethod(base))).toEqual(
      ['id', 'userId', 'type', 'label', 'createdAt', 'confirmedAt', 'lastUsedAt'],
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd template/libs/core && npx vitest run tests/mfa/entities/MfaMethod.spec.ts
```

Expected: FAIL — cannot resolve `../../../src/mfa/entities/MfaMethod`.

- [ ] **Step 3: Write the enums**

`MfaMethodType` gets both members and a TSDoc that gives `AuthProvider`'s reason for it in this domain's own words: members are never added later because a stored value changing meaning rewrites history, and values are member names because a numeric enum stores a position.

```ts
export enum MfaMethodType {
  /** A time-based one-time code, from a shared secret the person's app holds. */
  TOTP = 'TOTP',
  /** A key pair held by an authenticator, proven by signing a challenge. */
  WEBAUTHN = 'WEBAUTHN',
}
```

```ts
export enum MfaStep {
  /** Nothing further is required; a session may be issued. */
  ISSUE_SESSION = 'ISSUE_SESSION',
  /** Credentials were proven, and are not enough on their own. */
  REQUIRE_SECOND_FACTOR = 'REQUIRE_SECOND_FACTOR',
}
```

```ts
export enum MfaRemovalDecision {
  /** The session that asked is sufficient. */
  ALLOWED = 'ALLOWED',
  /** A live proof of the second factor must accompany the request. */
  REAUTHENTICATION_REQUIRED = 'REAUTHENTICATION_REQUIRED',
}
```

- [ ] **Step 4: Write the types and the entity**

`MfaMethodId` is `Brand<string, 'MfaMethodId'>`, following `AuthIdentityId`. `MfaMethodProps` is the seven facts. `MfaMethodJSON` is the wire shape with ISO-8601 strings, following `AuthIdentityJSON`.

`MfaMethod` has the seven readonly fields in the order the test pins, a constructor that trims `label` and throws `MfaLabelRequiredError` when it is empty, `isConfirmed(): boolean`, and `toJSON(): MfaMethodJSON`. **Its TSDoc must state, in this domain's own words, that it holds no secret material and why** — do not copy `AuthIdentity`'s sentences verbatim; make the same argument about this entity.

- [ ] **Step 5: Write the ten errors**

One file each, each extending `DomainError`, following `template/libs/core/src/identities/errors/IdentityNotFoundError.ts`:

`MfaLabelRequiredError`, `MfaMethodNotFoundError`, `MfaMethodAlreadyConfirmedError`, `MfaEnrollmentLimitError`, `MfaChallengeNotFoundError`, `MfaChallengeExpiredError`, `MfaChallengeAlreadyConsumedError`, `MfaVerificationFailedError`, `RecoveryCodeAlreadyConsumedError`, `MfaReauthenticationRequiredError`.

- [ ] **Step 6: Add the subpath exports**

In `template/libs/core/package.json`, add `./mfa/*` subpaths exactly as `./identities/*` is declared. Read that block; do not invent a new shape.

- [ ] **Step 7: Ban the four new packages from core, before anything can import one**

Spec §14. Add `otplib`, `@simplewebauthn/server`, `@simplewebauthn/browser` and `qrcode` to the `no-restricted-imports` list in `template/libs/core/eslint.config.mjs`, beside `typeorm` and `@nestjs/*`. The ban lands in the task that creates the domain they would be imported into, not in the task that installs them — a ban added after the import it forbids is a ban that has already failed once.

- [ ] **Step 8: Run the test, the purity gate, and lint**

```bash
cd template/libs/core && npx vitest run tests/mfa/ && npm run lint && npm run typecheck
cd ../.. && grep -riE "\bjwt\b|cookie|http" template/libs/core/src && echo "D14 VIOLATION" || echo "D14 clean"
```

Expected: tests PASS, lint clean, D14 clean.

- [ ] **Step 9: Commit**

```bash
git add template/libs/core && git commit -m "$(cat <<'MSG'
feat(core): the mfa domain — MfaMethod, its enums, types and errors

MfaMethod holds no secret material, for AuthIdentity's reason: no
serialization can leak what there is no field for. A test pins the
field list and the absence, and it was written before the entity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The two pure policies — and the slow tiers, early

**Files:**
- Create: `template/libs/core/src/mfa/policies/decideAuthenticationStep.ts`, `policies/decideMfaRemoval.ts`, `policies/index.ts`
- Create: `template/libs/core/src/mfa/types/AuthenticationStepDecision.ts`
- Test: `template/libs/core/tests/mfa/policies/decideAuthenticationStep.spec.ts`, `tests/mfa/policies/decideMfaRemoval.spec.ts`

**Interfaces:**
- Consumes: `MfaMethod`, `MfaStep`, `MfaRemovalDecision` (Task 2).
- Produces:
  ```ts
  export function decideAuthenticationStep(methods: readonly MfaMethod[]): AuthenticationStepDecision;
  export function decideMfaRemoval(
    methods: readonly MfaMethod[],
    methodId: MfaMethodId,
    validProofPresented: boolean,
  ): MfaRemovalDecision;
  ```
  `AuthenticationStepDecision` is
  ```ts
  export type AuthenticationStepDecision
    = | { readonly step: MfaStep.ISSUE_SESSION }
      | { readonly step: MfaStep.REQUIRE_SECOND_FACTOR; readonly methods: readonly MfaMethod[] };
  ```
  Tasks 9 and 10 both call `decideAuthenticationStep`. Task 11 calls `decideMfaRemoval`.

**Read first:** `template/libs/core/src/identities/policies/decideFederatedSignIn.ts`. That is the shape: a pure function over a discriminated union, whose TSDoc argues the *order* of its checks as the security property. Write this one the same way.

- [ ] **Step 1: Write the failing test — a table, not a sequence**

Jest and vitest both abort an `it` at the first failing `expect`, so a second assertion after a failing one is dead code that reads as coverage. Phase 4 shipped exactly that defect. Use `it.each`.

```ts
// template/libs/core/tests/mfa/policies/decideAuthenticationStep.spec.ts
import { describe, expect, it } from 'vitest';
import { MfaMethod } from '../../../src/mfa/entities/MfaMethod';
import { MfaMethodType } from '../../../src/mfa/enums/MfaMethodType';
import { MfaStep } from '../../../src/mfa/enums/MfaStep';
import { decideAuthenticationStep } from '../../../src/mfa/policies/decideAuthenticationStep';
import type { MfaMethodId } from '../../../src/mfa/types/MfaMethodId';
import type { UserId } from '../../../src/users/types/UserId';

const method = (confirmed: boolean, type = MfaMethodType.TOTP): MfaMethod =>
  new MfaMethod({
    id: `m-${Math.random()}` as MfaMethodId,
    userId: 'u-1' as UserId,
    type,
    label: 'A method',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    confirmedAt: confirmed ? new Date('2026-01-02T00:00:00Z') : null,
    lastUsedAt: null,
  });

describe('decideAuthenticationStep', () => {
  it.each([
    ['no methods at all',                       [],                                    MfaStep.ISSUE_SESSION],
    // Review Focus 3. An enrollment somebody abandoned must not lock them out of
    // their own account. Derived from spec §3.1, written before the policy.
    ['one method, unconfirmed',                 [method(false)],                       MfaStep.ISSUE_SESSION],
    ['several methods, all unconfirmed',        [method(false), method(false)],        MfaStep.ISSUE_SESSION],
    ['one confirmed method',                    [method(true)],                        MfaStep.REQUIRE_SECOND_FACTOR],
    ['one confirmed among unconfirmed',         [method(false), method(true)],         MfaStep.REQUIRE_SECOND_FACTOR],
    ['a confirmed WebAuthn method alone',       [method(true, MfaMethodType.WEBAUTHN)], MfaStep.REQUIRE_SECOND_FACTOR],
  ])('%s → %s', (_name, methods, expected) => {
    expect(decideAuthenticationStep(methods).step).toBe(expected);
  });

  it('returns only the confirmed methods, so a client never prompts for one that cannot be used', () => {
    const confirmed = method(true);
    const decision = decideAuthenticationStep([method(false), confirmed]);
    expect(decision.step).toBe(MfaStep.REQUIRE_SECOND_FACTOR);
    if (decision.step !== MfaStep.REQUIRE_SECOND_FACTOR) throw new Error('unreachable');
    expect(decision.methods).toEqual([confirmed]);
  });
});
```

And for removal:

```ts
// template/libs/core/tests/mfa/policies/decideMfaRemoval.spec.ts
describe('decideMfaRemoval', () => {
  it.each([
    ['two confirmed, removing one, no valid proof',   2, false, MfaRemovalDecision.ALLOWED],
    ['two confirmed, removing one, with proof', 2, true,  MfaRemovalDecision.ALLOWED],
    ['one confirmed, removing it, no proof',    1, false, MfaRemovalDecision.REAUTHENTICATION_REQUIRED],
    ['one confirmed, removing it, with proof',  1, true,  MfaRemovalDecision.ALLOWED],
  ])('%s → %s', (_name, confirmedCount, proofPresented, expected) => { /* … */ });
});
```

- [ ] **Step 2: Run both and watch them fail**

```bash
cd template/libs/core && npx vitest run tests/mfa/policies/
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `decideAuthenticationStep`**

```ts
export function decideAuthenticationStep(
  methods: readonly MfaMethod[],
): AuthenticationStepDecision {
  const confirmed = methods.filter((method) => method.isConfirmed());
  if (confirmed.length === 0) return { step: MfaStep.ISSUE_SESSION };
  return { step: MfaStep.REQUIRE_SECOND_FACTOR, methods: confirmed };
}
```

Its TSDoc argues the one thing that is not obvious: **an unconfirmed method is not a weaker gate, it is no gate at all**, because gating on one turns an abandoned enrollment into a lockout, and the person it locks out has no way to prove anything.

- [ ] **Step 4: Write `decideMfaRemoval`**

Confirmed methods other than the one being removed → `ALLOWED`. Otherwise `validProofPresented ? ALLOWED : REAUTHENTICATION_REQUIRED`. Its TSDoc records spec §16.1: re-authentication here means re-proving the **second factor**, not the password, because an OAuth-only account has no password to present and the threat is a session already hijacked.

- [ ] **Step 5: Run the tests, then inject a fault and watch one fail**

```bash
cd template/libs/core && npx vitest run tests/mfa/policies/
```
Expected: PASS.

Now change `filter((m) => m.isConfirmed())` to `filter(() => true)` and re-run. **Expected: the "one method, unconfirmed" row fails.** Record that you observed it. Revert.

- [ ] **Step 6: Run the slow tiers — early, on a tree that has barely changed**

This is the point of doing it here. Phase 4 deferred these to the end and paid two unrelated on-the-merits failures before a single assertion of the new work could run.

```bash
docker run --rm alpine df -h /
```
Confirm ≥ 3 GB available before continuing.

```bash
cd /Users/sinisimattia/Progetti/forge && npm test
FORGE_E2E=1 npm test 2>&1 | tail -40
```

Expected: both green. **If either fails, that failure is Task 3's problem and is fixed here**, before any MFA code depends on the tier being trustworthy. Record what was found in `docs/superpowers/phase-5-decision-log.md`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
feat(core): decideAuthenticationStep and decideMfaRemoval

An unconfirmed method is no gate at all: gating on one turns an
abandoned enrollment into a lockout of somebody who can prove nothing.
Pinned by a table, because a second expect after a failing one is dead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: `AuthenticationOutcome` grows a third variant

The member and the variant land together. A bare enum member adds no variant, `assertNever` still receives `never`, and the exhaustiveness injection fails nothing, anywhere — Phase 3 recorded this, Phase 4 deliberately added no member, and this task is the first to meet it.

**Files:**
- Modify: `template/libs/core/src/auth/enums/AuthenticationStatus.ts`
- Modify: `template/libs/core/src/auth/types/AuthenticationOutcome.ts`
- Modify: every `switch` that stops compiling — at minimum `template/apps/backend/src/auth/auth.controller.ts:145`, and whatever `npm run typecheck` names
- Test: `template/libs/core/tests/auth/types/AuthenticationOutcome.spec.ts`

**Interfaces:**
- Consumes: `MfaMethod` (Task 2).
- Produces: `AuthenticationStatus.MFA_REQUIRED`, and the variant
  ```ts
  | {
      readonly status: AuthenticationStatus.MFA_REQUIRED;
      readonly user: User;
      readonly methods: readonly MfaMethod[];
    }
  ```
  Tasks 9 and 10 return it. **No challenge token is in this union** — `AuthenticationOutcome`'s existing TSDoc is the authority: the implementation carries that beside the shape, and the domain never learns it existed.

- [ ] **Step 1: Write the failing test — the exhaustiveness injection**

```ts
// template/libs/core/tests/auth/types/AuthenticationOutcome.spec.ts
import { describe, expect, it } from 'vitest';
import { AuthenticationStatus } from '../../../src/auth/enums/AuthenticationStatus';
import type { AuthenticationOutcome } from '../../../src/auth/types/AuthenticationOutcome';
import { assertNever } from '../../../src/shared/policies/assertNever';

describe('AuthenticationOutcome', () => {
  it('has a variant for every AuthenticationStatus member', () => {
    // If a member is added without a variant, this switch still compiles with
    // `never` reaching assertNever — which is the failure this asserts against.
    // Every member must be reachable as a discriminant here.
    const statuses = Object.values(AuthenticationStatus);
    const handled: AuthenticationStatus[] = [];
    const handle = (outcome: AuthenticationOutcome): void => {
      switch (outcome.status) {
        case AuthenticationStatus.AUTHENTICATED: handled.push(outcome.status); return;
        case AuthenticationStatus.REJECTED: handled.push(outcome.status); return;
        case AuthenticationStatus.MFA_REQUIRED: handled.push(outcome.status); return;
        default: return assertNever(outcome);
      }
    };
    expect(handle).toBeTypeOf('function');
    expect(statuses).toContain(AuthenticationStatus.MFA_REQUIRED);
    expect(statuses).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd template/libs/core && npx vitest run tests/auth/types/AuthenticationOutcome.spec.ts
```

Expected: FAIL — `MFA_REQUIRED` does not exist on `AuthenticationStatus`.

- [ ] **Step 3: Add the member and the variant together**

```ts
  /** Credentials were proven and are not enough; a second factor is owed. */
  MFA_REQUIRED = 'MFA_REQUIRED',
```

and in `AuthenticationOutcome`, the third branch with `user` and `methods`. Extend the union's TSDoc: it already predicted this arrival — say that it happened, and keep the sentence about carrying credentials beside the shape, which is now load-bearing for a second reason.

- [ ] **Step 4: Fix every switch the compiler names**

```bash
cd /Users/sinisimattia/Progetti/forge && npm run typecheck
```

Every error is a `switch` that must now handle `MFA_REQUIRED`. **In this task, `auth.controller.ts` handles it by throwing `UnauthorizedException` — a placeholder that is replaced in Task 9.** That is deliberate: it keeps the compiler green without inventing a transport shape three tasks before the transport exists, and it fails closed in the interim.

- [ ] **Step 5: Run everything**

```bash
npm run typecheck && npm test
```

Expected: PASS. Note which files the compiler forced you to touch and write the count into the report — that count is the exhaustiveness property working.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
feat(core): AuthenticationStatus.MFA_REQUIRED, with its variant

The member and the variant land together. A bare member adds no
variant, so assertNever still receives never and the exhaustiveness
injection fails nothing, anywhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The schema — three tables, and a mapper that refuses an impossible row

**Files:**
- Create: `template/apps/backend/src/db/migrations/1758000005000-Mfa.ts`
- Create: `template/apps/backend/src/mfa/entities/{mfa-method-record,mfa-recovery-code-record,mfa-challenge-record}.entity.ts`
- Create: `template/apps/backend/src/mfa/enums/MfaChallengePurpose.ts`
- Create: `template/apps/backend/src/mfa/mapMfaMethodRecord.ts`
- Test: `template/apps/backend/src/mfa/__tests__/mapMfaMethodRecord.spec.ts`
- Modify: `template/apps/backend/src/db/__tests__/schema-drift.spec.ts` (the expected-table list) — **find it first**; the roadmap records that this list went stale for a phase and a half

**Read first, before writing a line of SQL:** `template/apps/backend/src/db/__tests__/migration-sql.spec.ts`. It is a **fail-closed static guard over every migration's SQL**, so a construct it does not whitelist is rejected even when it is correct Postgres. Read its whitelist and write SQL that satisfies it. Also read `1758000004000-OAuthAuthorizationRequests.ts` for the TSDoc voice and the named-constraint convention.

**Interfaces:**
- Consumes: `MfaMethod`, `MfaMethodType` (Task 2).
- Produces:
  ```ts
  export enum MfaChallengePurpose { LOGIN = 'LOGIN', WEBAUTHN_ENROLLMENT = 'WEBAUTHN_ENROLLMENT' }
  export function mapMfaMethodRecord(record: MfaMethodRecord): MfaMethod;
  ```
  plus the three record classes. Tasks 6, 8, 11–15 consume them.

- [ ] **Step 1: Write the failing test — the mapper refuses a row whose type and material disagree**

```ts
// template/apps/backend/src/mfa/__tests__/mapMfaMethodRecord.spec.ts
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { mapMfaMethodRecord } from '../mapMfaMethodRecord';

const row = (over: Partial<MfaMethodRecord>): MfaMethodRecord =>
  Object.assign(new MfaMethodRecord(), {
    id: 'm-1', userId: 'u-1', type: 'TOTP', label: 'Phone',
    totpSecret: 'JBSWY3DPEHPK3PXP', totpLastStep: null,
    webauthnCredentialId: null, webauthnPublicKey: null, webauthnCounter: null,
    confirmedAt: null, lastUsedAt: null, createdAt: new Date(),
  }, over);

describe('mapMfaMethodRecord', () => {
  it('maps a well-formed TOTP row', () => {
    expect(mapMfaMethodRecord(row({})).type).toBe(MfaMethodType.TOTP);
  });

  it('maps a well-formed WebAuthn row', () => {
    const method = mapMfaMethodRecord(row({
      type: 'WEBAUTHN', totpSecret: null,
      webauthnCredentialId: 'cred-1', webauthnPublicKey: 'pk', webauthnCounter: '0',
    }));
    expect(method.type).toBe(MfaMethodType.WEBAUTHN);
  });

  // The fail-closed properties. `type` is plain text with no CHECK — correctly,
  // because every enum-ish column in this schema is — so this mapper is the only
  // thing standing between a corrupted value and the code that acts on it.
  it.each([
    ['a type nothing models',        { type: 'SMS' }],
    ['an empty type',                { type: '' }],
    ['a TOTP row with no secret',    { type: 'TOTP', totpSecret: null }],
    ['a WebAuthn row with no key',   { type: 'WEBAUTHN', totpSecret: null, webauthnCredentialId: 'c', webauthnPublicKey: null }],
    ['a WebAuthn row with no id',    { type: 'WEBAUTHN', totpSecret: null, webauthnPublicKey: 'pk', webauthnCredentialId: null }],
  ])('refuses %s', (_name, over) => {
    expect(() => mapMfaMethodRecord(row(over as Partial<MfaMethodRecord>))).toThrow();
  });
});
```

A `TOTP` row with a null secret is **not** a method that merely fails to verify. It is an account whose login now demands a factor it can never supply — a lockout — so it throws at read, where somebody can still see it, rather than at the next sign-in attempt by the person it has trapped.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd template/apps/backend && npx cross-env NODE_ENV=test npx jest src/mfa/__tests__/mapMfaMethodRecord.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the migration**

Three `CREATE TABLE`s in one `up`, dropped in reverse in `down`. Every column and constraint exactly as spec §5.1–5.3 lists them, including `totp_last_step bigint NULL`. Every `user_id` is `uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE`. Named constraints only: `uq_mfa_methods_webauthn_credential`, `uq_mfa_recovery_codes_code_hash`, `uq_mfa_challenges_token_hash`; indexes `ix_mfa_methods_user_id`, `ix_mfa_recovery_codes_user_id`, `ix_mfa_challenges_user_id`.

**No `CHECK` constraint on `type` or `purpose`.** That is consistent with every other enum-ish column in this schema, and the refusal lives in code where it can say why. The TSDoc says this explicitly so the next reader does not "finish the job".

- [ ] **Step 4: Write the three record entities**

Following `email-verification-token-record.entity.ts` in structure and TSDoc voice. `mfa_challenges` gets `purpose` as plain `text` typed as `MfaChallengePurpose` in TypeScript — with a comment saying the type is a claim about what is *written*, never a guarantee about what is *read*.

- [ ] **Step 5: Write the mapper**

Explicit equality per modelled `MfaMethodType` member, each branch asserting its own material, and an unconditional throwing fallthrough. Never a ternary. Never a default that proceeds.

- [ ] **Step 6: Update the schema-drift expectations**

Add `mfa_methods`, `mfa_recovery_codes`, `mfa_challenges` to the expected-table list. Then run that spec and watch it pass — and note in the report that you ran it, because the roadmap records this exact list going stale for a phase and a half while nobody ran the tier that reads it.

- [ ] **Step 7: Run the tests and the migration guard**

```bash
cd template/apps/backend && npx cross-env NODE_ENV=test npx jest src/mfa src/db
```

Expected: PASS, including `migration-sql.spec.ts`.

- [ ] **Step 8: Inject the fault and watch it fail**

Change the mapper's TOTP branch to skip the secret check, re-run, and confirm the "a TOTP row with no secret" row fails. Record it. Revert.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
feat(backend): mfa_methods, mfa_recovery_codes, mfa_challenges

type and purpose are plain text with no CHECK, as every enum-ish column
in this schema is. The refusal lives in the mapper, which reads a row
whose type and material disagree as a lockout rather than a method that
merely fails to verify.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The challenge — minted, hashed, consumed once, swept, and refused when its purpose is unmodelled

The single most security-sensitive file in this phase. Phase 4's `oauth_authorization_requests` is the same machinery and its service is the reference implementation; **read `template/apps/backend/src/auth/oauth/oauth.service.ts` lines 230–400 before writing anything here.**

**Files:**
- Create: `template/apps/backend/src/mfa/mfa-challenge.service.ts`
- Test: `template/apps/backend/src/mfa/__tests__/mfa-challenge.service.spec.ts`

**Interfaces:**
- Consumes: `MfaChallengeRecord`, `MfaChallengePurpose` (Task 5); `hashOpaqueToken` from `../common/crypto/hashOpaqueToken`.
- Produces:
  ```ts
  mint(userId: UserId, purpose: MfaChallengePurpose, webauthnChallenge: string | null): Promise<string>;
  consume(token: string, expected: MfaChallengePurpose): Promise<MfaChallengeRecord>;
  ```
  `mint` returns the **plaintext** token, once, and stores only its digest. `consume` throws on absent, expired, already-consumed, or purpose-mismatched. Tasks 9, 11, 13, 15 call both.

**Four properties, and each is a test:**

1. The token is stored as a digest, never in the clear.
2. The row is read **inside a transaction, under `pessimistic_write`**, and consumed in that same transaction before anything else is called.
3. `purpose` is dispatched by explicit equality with an unconditional refusing fallthrough.
4. Expired rows are swept on write — and the sweep is asserted by seeding an expired row and watching it go. Phase 4 shipped a sweep that two artifacts claimed and nothing performed.

- [ ] **Step 1: Write the failing tests**

```ts
describe('MfaChallengeService', () => {
  it('stores a digest, never the token', async () => {
    const token = await service.mint(userId, MfaChallengePurpose.LOGIN, null);
    const rows = await dataSource.getRepository(MfaChallengeRecord).find();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashOpaqueToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it('consumes a challenge exactly once', async () => {
    const token = await service.mint(userId, MfaChallengePurpose.LOGIN, null);
    await expect(service.consume(token, MfaChallengePurpose.LOGIN)).resolves.toBeDefined();
    await expect(service.consume(token, MfaChallengePurpose.LOGIN)).rejects.toThrow();
  });

  // Review Focus 5. A double-clicked button sends two verifications for one
  // challenge; exactly one may win. The write lock is the mechanism, and this
  // is the assertion that it is actually held.
  it('lets exactly one of two concurrent consumptions win', async () => {
    const token = await service.mint(userId, MfaChallengePurpose.LOGIN, null);
    const results = await Promise.allSettled([
      service.consume(token, MfaChallengePurpose.LOGIN),
      service.consume(token, MfaChallengePurpose.LOGIN),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('refuses an expired challenge', async () => { /* seed expiresAt in the past */ });

  it('refuses a challenge whose purpose is not the one expected', async () => {
    const token = await service.mint(userId, MfaChallengePurpose.WEBAUTHN_ENROLLMENT, 'nonce');
    await expect(service.consume(token, MfaChallengePurpose.LOGIN)).rejects.toThrow();
  });

  // THE Phase 4 replay, run forward. `purpose` is plain text with no CHECK, so
  // this is the value an attacker with any write path — or a corrupted
  // migration, or a future bug — puts there. Phase 4's equivalent minted a real,
  // usable session for exactly this row.
  it('refuses a purpose it does not model, written directly into the table', async () => {
    const token = 'a-token-of-full-entropy-for-this-test';
    await dataSource.getRepository(MfaChallengeRecord).insert({
      userId, tokenHash: hashOpaqueToken(token), purpose: 'SOMETHING_ELSE' as MfaChallengePurpose,
      webauthnChallenge: null, expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null, createdAt: new Date(),
    });
    await expect(service.consume(token, MfaChallengePurpose.LOGIN)).rejects.toThrow();
  });

  it('sweeps expired rows when it mints', async () => {
    await dataSource.getRepository(MfaChallengeRecord).insert({
      userId, tokenHash: 'stale', purpose: MfaChallengePurpose.LOGIN, webauthnChallenge: null,
      expiresAt: new Date(Date.now() - 60_000), consumedAt: null, createdAt: new Date(),
    });
    await service.mint(userId, MfaChallengePurpose.LOGIN, null);
    const stale = await dataSource.getRepository(MfaChallengeRecord).findOneBy({ tokenHash: 'stale' });
    expect(stale).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd template/apps/backend && npx cross-env NODE_ENV=test npx jest src/mfa/__tests__/mfa-challenge.service.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mint`**

Draw the token from `randomBytes(32).toString('base64url')`. Sweep expired rows. Insert with `tokenHash: hashOpaqueToken(token)`, `expiresAt` five minutes out. **Return the plaintext token, and let it exist nowhere else.**

- [ ] **Step 4: Implement `consume`**

```ts
const row = await this.dataSource.transaction(async (manager) => {
  const found = await manager.findOne(MfaChallengeRecord, {
    where: { tokenHash: hashOpaqueToken(token) },
    lock: { mode: 'pessimistic_write' },
  });
  if (found === null) throw new MfaChallengeNotFoundError();
  if (found.consumedAt !== null) throw new MfaChallengeAlreadyConsumedError();
  if (found.expiresAt.getTime() <= Date.now()) throw new MfaChallengeExpiredError();

  // Explicit equality per modelled value, and an unconditional refusing
  // fallthrough. `purpose` is plain text with no CHECK, so anything may be in
  // this column; on a security branch the safe default is refuse, not proceed.
  if (found.purpose !== MfaChallengePurpose.LOGIN
    && found.purpose !== MfaChallengePurpose.WEBAUTHN_ENROLLMENT) {
    throw new MfaChallengeNotFoundError();
  }
  if (found.purpose !== expected) throw new MfaChallengeNotFoundError();

  await manager.update(MfaChallengeRecord, { id: found.id, consumedAt: IsNull() }, { consumedAt: new Date() });
  return found;
});
```

The refusals all raise the *same* error deliberately: a caller learns only that the challenge did not work, never which of five reasons applied.

- [ ] **Step 5: Run the tests**

Expected: all PASS, including the concurrency one.

- [ ] **Step 6: Inject three faults, one at a time, and watch each fail**

1. Remove `lock: { mode: 'pessimistic_write' }` → the concurrent test must fail.
2. Replace the purpose check with `if (found.purpose === expected || true)` → the unmodelled-purpose test must fail.
3. Remove the sweep from `mint` → the sweep test must fail.

Record all three observations in the report. **This is the task where a check that cannot fail would be least visible and most expensive.**

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
feat(backend): the MFA challenge — minted, hashed, consumed once, swept

Phase 4's oauth_authorization_requests machinery, second
implementation. purpose is dispatched by explicit equality with an
unconditional refusing fallthrough, and a row written directly with an
unmodelled purpose is refused — the replay that minted a real session
in Phase 4, run forward.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: `IMfaService` and its conformance suite

**Files:**
- Create: `template/libs/core/src/mfa/contracts/IMfaService.ts`, `contracts/index.ts`
- Create: `template/libs/core/src/mfa/testing/mfaServiceConformance.ts`, `testing/index.ts`
- Test: driven from the suite by both adapters in later tasks

**Read first:** `template/libs/core/README.md` on **DEC-1**, the shared-versus-server-only suite split. An assertion only the implementation that owns the store can honestly satisfy does **not** belong in the shared suite. Phase 2 put a client-context assertion in the shared suite and the webapp could satisfy it only by having its stub lie.

**Interfaces:**
- Consumes: `MfaMethod`, `MfaMethodId`, `MfaMethodType`, the errors (Task 2).
- Produces:
  ```ts
  export interface IMfaService {
    listMethods(actorId: UserId): Promise<MfaMethod[]>;
    beginTotpEnrollment(actorId: UserId, label: string): Promise<TotpEnrollmentOffer>;
    confirmTotpEnrollment(actorId: UserId, methodId: MfaMethodId, code: string): Promise<RecoveryCodeBatch | null>;
    removeMethod(actorId: UserId, methodId: MfaMethodId, proof: MfaProof | null): Promise<void>;
    regenerateRecoveryCodes(actorId: UserId, proof: MfaProof): Promise<RecoveryCodeBatch>;
  }
  ```
  with `TotpEnrollmentOffer = { methodId, otpauthUri, qrSvg, secret }`, `RecoveryCodeBatch = { codes: readonly string[] }`, and `MfaProof = { methodId: MfaMethodId; code: string } | { recoveryCode: string }`. **`MfaProof` is a discriminated union on field presence, never a single string the implementation sniffs** — Phase 4's Task 6 defect was a shapeless string a format-only check would also pass.

- [ ] **Step 1: Write the conformance suite**

Shared assertions (any implementation must satisfy honestly): listing returns only the actor's methods; confirming an already-confirmed method throws `MfaMethodAlreadyConfirmedError`; removing an unknown method throws `MfaMethodNotFoundError`; the first confirmation returns a batch and a later one returns `null`.

Server-only assertions (DEC-1 — move these to the backend security suite): a method belonging to another user is indistinguishable from one that does not exist; recovery codes are stored as digests.

- [ ] **Step 2: Wire the suite's runner**

Follow `template/libs/core/src/identities/testing/` exactly — same `ConformanceRunner`/`ConformanceExpect` shape.

- [ ] **Step 3: Typecheck and lint**

```bash
cd template/libs/core && npm run typecheck && npm run lint
```

- [ ] **Step 4: Commit**

```bash
git add template/libs/core && git commit -m "$(cat <<'MSG'
feat(core): IMfaService and its conformance suite

MfaProof is a union on field presence, never a string the
implementation sniffs: a discriminator that is a field name cannot be
fooled by a well-chosen input.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: TOTP — verified against the RFC's vectors, and refused on replay

**Files:**
- Create: `template/apps/backend/src/mfa/totp/TotpVerifier.ts`
- Modify: `template/apps/backend/package.json` (add `otplib`)
- Test: `template/apps/backend/src/mfa/totp/__tests__/TotpVerifier.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  verify(secret: string, code: string, lastStep: number | null, now?: Date): { accepted: boolean; step: number };
  ```
  Task 9 and Task 11 call it. `step` is the accepted time step, to be written to `mfa_methods.totp_last_step`.

**Why the vectors matter, and this is not ceremony.** A TOTP implementation verified by a test that recomputes the same HMAC is Phase 3's tautology rule exactly — the driver's expectation and the implementation's answer drawn from one source — and it passes while proving nothing. **RFC 6238 Appendix B is an independent source that existed before this code.**

- [ ] **Step 1: Write the failing test from the RFC's published vectors**

RFC 6238 Appendix B, SHA-1, secret `12345678901234567890` (ASCII; `3132333435363738393031323334353637383930` in hex), **8 digits**, 30-second step:

| Unix time | Expected code |
|---|---|
| 59 | `94287082` |
| 1111111109 | `07081804` |
| 1111111111 | `14050471` |
| 1234567890 | `89005924` |
| 2000000000 | `69279037` |
| 20000000000 | `65353130` |

```ts
it.each([
  [59,          '94287082'],
  [1111111109,  '07081804'],
  [1111111111,  '14050471'],
  [1234567890,  '89005924'],
  [2000000000,  '69279037'],
  [20000000000, '65353130'],
])('accepts RFC 6238 vector at t=%i', (unixTime, code) => {
  expect(verifyRfcVector(RFC_SECRET, code, new Date(unixTime * 1000)).accepted).toBe(true);
});
```

> **Configure otplib's key encoding and digit count explicitly, and let the vectors tell you whether you got it right.** `otplib` exposes both a `totp` and an `authenticator` variant with different default key encodings (hex vs. base32) and the vectors will simply fail if the encoding is wrong. Do not assume a default — set `digits`, `step`, `algorithm` and the key encoding explicitly, and make the table above pass. If reconciling the vectors needs a test-only 8-digit configuration alongside the 6-digit production one, that is expected and correct; say so in the TSDoc.

- [ ] **Step 2: Write the replay test — Review Focus 4**

```ts
it('refuses a code already accepted in its own window', () => {
  const now = new Date('2026-03-01T12:00:15Z');
  const first = verifier.verify(secret, validCodeFor(now), null, now);
  expect(first.accepted).toBe(true);
  // Same code, same 30-second step, seconds later. A code seen over a
  // shoulder or replayed from a proxy is valid for the rest of its step
  // unless the step it belongs to is recorded and required to advance.
  const second = verifier.verify(secret, validCodeFor(now), first.step, new Date(now.getTime() + 5000));
  expect(second.accepted).toBe(false);
});

it('accepts the next step after one has been used', () => {
  const now = new Date('2026-03-01T12:00:15Z');
  const used = verifier.verify(secret, validCodeFor(now), null, now).step;
  const later = new Date(now.getTime() + 30_000);
  expect(verifier.verify(secret, validCodeFor(later), used, later).accepted).toBe(true);
});
```

- [ ] **Step 3: Run both and watch them fail**

```bash
cd template/apps/backend && npm install otplib && npx cross-env NODE_ENV=test npx jest src/mfa/totp
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

A ±1 step window (clock skew is real; two steps either side is not). Accept only when the candidate step is `null`-lastStep or **strictly greater** than `lastStep`. Return the accepted step so the caller can persist it.

- [ ] **Step 5: Run them and watch them pass, then inject the fault**

Change `step > lastStep` to `step >= lastStep` and confirm the replay test fails. Record it. Revert.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
feat(backend): TOTP, pinned to RFC 6238's published vectors

An independent source that existed before this code. A test that
recomputes the same HMAC asserts the implementation, not the
requirement, and passes either way.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Two-phase login, and D10

**Files:**
- Modify: `template/apps/backend/src/auth/auth.service.ts` (`signIn`)
- Modify: `template/apps/backend/src/auth/auth.controller.ts` (replace Task 4's placeholder)
- Create: `template/apps/backend/src/mfa/mfa-verification.service.ts`
- Create: `template/apps/backend/src/auth/dto/mfa-challenge-response.dto.ts`
- Create: `template/apps/backend/src/__tests__/discriminating/d10-mfa-challenge-only.spec.ts`
- Test: `template/apps/backend/src/mfa/__tests__/mfa-verification.service.spec.ts`

**Interfaces:**
- Consumes: `decideAuthenticationStep` (Task 3); `AuthenticationStatus.MFA_REQUIRED` (Task 4); `MfaChallengeService.mint`/`.consume` (Task 6); `TotpVerifier.verify` (Task 8).
- Produces: `POST /auth/mfa/verify`; `SignInResult` gains `challengeToken: string | null` beside `credentials`, exactly as `credentials` is carried beside the outcome today.

- [ ] **Step 1: Write D10 — and assert the absence three times, not once**

```ts
// src/__tests__/discriminating/d10-mfa-challenge-only.spec.ts
it('returns a challenge token and NOTHING that grants access', async () => {
  // A user with a confirmed TOTP method, seeded directly — this test must not
  // depend on the enrollment endpoint, which is a later task.
  const { email, secret } = await seedUserWithConfirmedTotp();
  const sessionsBefore = await dataSource.getRepository(SessionRecord).count();

  const response = await request(app.getHttpServer())
    .post('/auth/login').send({ email, secret }).expect(200);

  // 1. No access credential in the body.
  expect(response.body.accessToken).toBeUndefined();
  expect(response.body.status).toBe(AuthenticationStatus.MFA_REQUIRED);
  expect(response.body.challengeToken).toEqual(expect.any(String));

  // 2. No refresh cookie.
  expect(response.headers['set-cookie'] ?? []).toEqual(
    expect.not.arrayContaining([expect.stringContaining(REFRESH_COOKIE_NAME)]),
  );

  // 3. No session row. The first two alone pass a system that creates the
  //    session and merely declines to mention it — this is the one that
  //    would have caught that.
  expect(await dataSource.getRepository(SessionRecord).count()).toBe(sessionsBefore);
});
```

- [ ] **Step 2: Write the cross-user test — Review Focus 2**

```ts
it('refuses a methodId belonging to a different user', async () => {
  const victim = await seedUserWithConfirmedTotp();
  const attacker = await seedUserWithConfirmedTotp();

  const login = await request(app.getHttpServer())
    .post('/auth/login').send({ email: victim.email, secret: victim.secret }).expect(200);

  // The attacker holds their OWN method and its secret, and a challenge token
  // for the victim. If the method is looked up by id alone, this succeeds and
  // anybody who can enroll a factor can complete anybody's second one.
  await request(app.getHttpServer())
    .post('/auth/mfa/verify')
    .send({
      challengeToken: login.body.challengeToken,
      methodId: attacker.methodId,
      code: currentCodeFor(attacker.totpSecret),
    })
    .expect(401);

  expect(await dataSource.getRepository(SessionRecord).count()).toBe(0);
});
```

- [ ] **Step 3: Run both and watch them fail**

```bash
cd template/apps/backend && npx cross-env NODE_ENV=test npx jest src/__tests__/discriminating/d10
```

Expected: FAIL — login currently throws `UnauthorizedException` on `MFA_REQUIRED` (Task 4's placeholder).

- [ ] **Step 4: Make `signIn` consult the policy**

After credentials verify and before `sessions.begin`, load the user's methods, call `decideAuthenticationStep`, and on `REQUIRE_SECOND_FACTOR` return
```ts
{ outcome: { status: MFA_REQUIRED, user, methods }, credentials: null, challengeToken: await challenges.mint(user.id, LOGIN, null) }
```
**`sessions.begin` is not reached on this branch.** That is D10's third assertion, and it is a structural property of where the branch returns, not a thing to remember.

- [ ] **Step 5: Implement `POST /auth/mfa/verify`**

Consume the challenge (purpose `LOGIN`). **Look the method up scoped by the challenge row's `userId`** — `findOne({ where: { id: methodId, userId: row.userId } })` — so a method belonging to anyone else is simply not found. Dispatch on `MfaMethodType` with explicit equality and a refusing fallthrough. On success write `totp_last_step` and `last_used_at`, then issue the session.

- [ ] **Step 6: Run everything, then inject two faults**

1. Drop `userId` from the method lookup → the cross-user test must fail.
2. Let the `MFA_REQUIRED` branch fall through to `sessions.begin` → D10's third assertion must fail.

Record both. Revert.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
feat(backend): two-phase login, and D10

D10 asserts an absence, which takes three assertions: no access token,
no refresh cookie, and no session row. The first two alone pass a
system that creates the session and merely declines to mention it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: The federated path honours MFA — and the spec is amended first

**This task closes a gap found in the spec during the plan's self-review.** The spec's §8 described two-phase login as a property of `POST /auth/login` and never mentioned the federated path; **§8.4 was added to close it before this plan was handed over.** An account with a confirmed TOTP method and a Google identity would sign in through the OAuth callback with **no second factor consulted** — a complete bypass of everything this phase builds, shipped by an implementer following the spec faithfully.

**Files:**
- Modify: `template/apps/backend/src/auth/oauth/oauth.service.ts` (`completeSignIn`)
- Modify: `template/apps/backend/src/auth/oauth/oauth.controller.ts` (the callback's landing)
- Test: `template/apps/backend/src/__tests__/discriminating/d10-mfa-challenge-only.spec.ts` (extend)

**Interfaces:**
- Consumes: `decideAuthenticationStep` (Task 3), `MfaChallengeService.mint` (Task 6).
- Produces: a federated callback that lands on `/mfa/challenge` with a challenge token rather than issuing a session.

- [ ] **Step 1: Read spec §8.4**

The spec was amended before this plan was handed over: **§8.4 "Every path that issues a session consults the policy"** is the requirement this task implements. Read it, and note that it was added *because* the rest of §8 describes two-phase login only as a property of `POST /auth/login` — the gap this task closes was a gap in the spec first.

- [ ] **Step 2: Write the failing test**

```ts
it('does not issue a session to an MFA-enrolled user arriving through a provider', async () => {
  const { userId } = await seedUserWithConfirmedTotp();
  await seedLinkedGoogleIdentity(userId, 'google-subject-1');
  const sessionsBefore = await dataSource.getRepository(SessionRecord).count();

  const callback = await completeDevProviderCallbackFor('google-subject-1');

  expect(await dataSource.getRepository(SessionRecord).count()).toBe(sessionsBefore);
  expect(callback.headers.location).toContain('/mfa/challenge');
});
```

- [ ] **Step 3: Run it and watch it fail**

Expected: FAIL — a session exists and the browser was sent to the landing URL. **This is the bypass, demonstrated.** Quote the failure in the report; it is the evidence that the gap was real and not theoretical.

- [ ] **Step 4: Implement**

In `completeSignIn`, after the decision names a user and before `sessions.begin`, load their methods and call `decideAuthenticationStep`. On `REQUIRE_SECOND_FACTOR`, mint a `LOGIN` challenge and land on `/mfa/challenge` with the token, exactly as the password path returns one.

- [ ] **Step 5: Run the whole backend suite**

```bash
cd template/apps/backend && npx cross-env NODE_ENV=test npx jest
```

Expected: PASS, D11 included — this task must not weaken the federated refusal it sits beside.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
fix(backend): the federated path consults the MFA policy too

A second factor is a property of the account, not of the way its owner
arrived. decideFederatedSignIn returning SIGN_IN_EXISTING reads like a
completed authentication and is not one; without this, an MFA-enrolled
user with a linked provider signed in with no second factor at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: Recovery codes — generated once, hashed, single-use

**Files:**
- Create: `template/apps/backend/src/mfa/recovery/recovery-codes.ts`
- Modify: `template/apps/backend/src/mfa/mfa-verification.service.ts` (accept a recovery code as proof)
- Test: `template/apps/backend/src/mfa/recovery/__tests__/recovery-codes.spec.ts`

**Interfaces:**
- Consumes: `hashOpaqueToken`, `MfaRecoveryCodeRecord` (Task 5).
- Produces: `generateRecoveryCodes(userId): Promise<readonly string[]>` (ten codes, plaintext returned once); `consumeRecoveryCode(userId, code): Promise<boolean>`.

**Not argon2.** Spec §11.1 argues this at length and the argument is load-bearing: a salted derivation is not lookupable, so verification degrades to argon2-verifying every unconsumed code a user holds; ten argon2 verifications per attempt is a self-inflicted denial of service; and it makes `uq_mfa_recovery_codes_code_hash` a constraint that can never fire.

- [ ] **Step 1: Write the failing tests**

```ts
it('generates ten codes and stores only their digests', async () => {
  const codes = await generateRecoveryCodes(userId);
  expect(codes).toHaveLength(10);
  const rows = await repo.findBy({ userId });
  expect(rows.map((r) => r.codeHash).sort()).toEqual(codes.map(hashOpaqueToken).sort());
  for (const code of codes) expect(JSON.stringify(rows)).not.toContain(code);
});

it('accepts a code once and refuses it thereafter', async () => {
  const [code] = await generateRecoveryCodes(userId);
  expect(await consumeRecoveryCode(userId, code)).toBe(true);
  expect(await consumeRecoveryCode(userId, code)).toBe(false);
});

it('refuses a code belonging to another user', async () => {
  const [code] = await generateRecoveryCodes(otherUserId);
  expect(await consumeRecoveryCode(userId, code)).toBe(false);
});

it('invalidates the previous batch when a new one is issued', async () => {
  const [old] = await generateRecoveryCodes(userId);
  await generateRecoveryCodes(userId);
  expect(await consumeRecoveryCode(userId, old)).toBe(false);
});

// The proof field is a discriminator, not a shape. A recovery code presented
// in the `code` field must not work, and a TOTP code in `recoveryCode` must
// not either — otherwise the discriminator is decorative.
it('does not accept a recovery code presented in the TOTP code field', async () => { /* … */ });
```

- [ ] **Step 2: Run and watch fail. Step 3: Implement.** Codes are `randomBytes(16).toString('base64url')`, grouped for legibility. Consumption is a single `UPDATE … WHERE code_hash = $1 AND user_id = $2 AND consumed_at IS NULL` and a check of the affected-row count — **atomic, so two concurrent presentations cannot both win.**

- [ ] **Step 4: Run, inject the fault (drop `AND consumed_at IS NULL`) and watch the single-use test fail. Commit.**

---

### Task 12: TOTP enrollment — the secret, the URI, and the QR

**Files:**
- Create: `template/apps/backend/src/mfa/totp/totp-enrollment.ts`
- Create: `template/apps/backend/src/mfa/mfa.service.ts`, `mfa.controller.ts`, `mfa.module.ts`
- Modify: `template/apps/backend/package.json` (add `qrcode`), `src/app.module.ts`
- Test: `template/apps/backend/src/mfa/__tests__/mfa.controller.spec.ts`

**Interfaces:**
- Consumes: `TotpVerifier` (Task 8), `mapMfaMethodRecord` (Task 5), `IMfaService` (Task 7), `generateRecoveryCodes` (Task 11).
- Produces: `POST /mfa/totp/enroll` → `{ methodId, otpauthUri, qrSvg, secret }`; `POST /mfa/totp/confirm` → `{ recoveryCodes }` on the first confirmation, `{ recoveryCodes: null }` after. `GET /mfa/methods` → `MfaMethodJSON[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('enrolls an unconfirmed method and returns a scannable offer', async () => {
  const offer = await post('/mfa/totp/enroll', { label: 'Phone' }, actorToken).expect(201);
  expect(offer.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  expect(offer.body.qrSvg).toContain('<svg');
  const row = await repo.findOneBy({ id: offer.body.methodId });
  expect(row?.confirmedAt).toBeNull();
});

// The property that stops an abandoned enrollment becoming a lockout, at the
// transport level this time. Task 3 pinned the policy; this pins the wiring.
it('does not make login two-phase until the method is confirmed', async () => {
  await post('/mfa/totp/enroll', { label: 'Phone' }, actorToken).expect(201);
  const login = await post('/auth/login', { email, secret }).expect(200);
  expect(login.body.accessToken).toEqual(expect.any(String));
});

it('confirms with a correct code, and refuses a wrong one', async () => { /* … */ });

it('refuses to confirm a method that is already confirmed', async () => { /* MfaMethodAlreadyConfirmedError → 409 */ });

it('returns methods without any secret material', async () => {
  const listed = await get('/mfa/methods', actorToken).expect(200);
  expect(JSON.stringify(listed.body)).not.toContain(knownSecret);
});
```

- [ ] **Step 2: Run them and watch them fail.** Expected: 404, the routes do not exist.

- [ ] **Step 3: Implement enrollment**

Generate the secret with `otplib`'s base32 generator. Build the `otpauth://totp/{issuer}:{email}?secret=…&issuer=…` URI with the issuer taken from configuration, never hard-coded. Render the QR with `qrcode`'s `toString(uri, { type: 'svg' })`. Insert the row with `confirmedAt: null`.

- [ ] **Step 4: Implement confirmation**

Verify the code with `TotpVerifier`, scoped to the actor's own method. Set `confirmedAt` and `totpLastStep`. If this is the actor's **first** confirmed method, call `generateRecoveryCodes` (Task 11) and return the batch. A later confirmation returns `null`: codes are generated once.

- [ ] **Step 5: Wire the module, run the suite, commit**

```bash
cd template/apps/backend && npx cross-env NODE_ENV=test npx jest src/mfa && npm run lint
git add -A && git commit -m "$(cat <<'MSG'
feat(backend): TOTP enrollment, confirmation, and the methods listing

Enrollment leaves the method unconfirmed, and an unconfirmed method
does not gate a login — pinned here at the transport level as well as
in the policy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 13: Removal, and what re-authentication means

**Files:**
- Modify: `template/apps/backend/src/mfa/mfa.service.ts`, `mfa.controller.ts`
- Test: `template/apps/backend/src/mfa/__tests__/mfa-removal.spec.ts`

**Interfaces:**
- Consumes: `decideMfaRemoval` (Task 3), `MfaProof` (Task 7), `consumeRecoveryCode` (Task 11).
- Produces: `DELETE /mfa/:id`, `POST /mfa/recovery-codes`.

- [ ] **Step 1: Write the failing tests**

```ts
it('removes a method when another confirmed one remains, on the session alone', async () => { /* 204 */ });

it('refuses to remove the last confirmed method without a live proof', async () => {
  await del(`/mfa/${onlyMethodId}`, actorToken).expect(403);
  expect(await repo.countBy({ userId, confirmedAt: Not(IsNull()) })).toBe(1);
});

it('removes the last confirmed method when a live proof accompanies it', async () => { /* … */ });

it('accepts a recovery code as the proof', async () => { /* the OAuth-only account's only option */ });

// A hijacked session must not be able to strip the factor that defeats it.
it('refuses a proof that is a stale TOTP code', async () => { /* a code from a previous step */ });

it('requires a proof to regenerate recovery codes', async () => {
  await post('/mfa/recovery-codes', {}, actorToken).expect(403);
});
```

- [ ] **Step 2: Run, watch fail. Step 3: Implement.** Verify the proof FIRST, through the same verification path Task 9 built — **one verifier, not two**, or the two can disagree about what a valid proof is — then pass the verdict to `decideMfaRemoval` as `validProofPresented`. The policy is pure and cannot verify anything itself; handing it an unverified "a proof was attached" boolean would make every removal allowed.

- [ ] **Step 4: Run, inject the fault (`validProofPresented` hard-coded `true`), watch the third test fail, commit.**

---

### Task 14: WebAuthn configuration, and the boot refusal

**Files:**
- Create: `template/apps/backend/src/mfa/webauthn/webauthn.config.ts`
- Modify: `template/apps/backend/package.json` (add `@simplewebauthn/server`), `.env.example`, `compose.yaml`, `compose.prod.yaml`
- Test: `template/apps/backend/src/mfa/webauthn/__tests__/webauthn.config.spec.ts`

**Read first:** `template/apps/backend/src/auth/oauth/oauth.config.ts` — `buildOAuthProviders` and its two start-up refusals are the shape to copy: a fail-closed registry, and a refusal that happens at boot rather than per request.

**Interfaces:**
- Produces: `buildWebAuthnConfig(env): WebAuthnConfig | null`. `null` means WebAuthn is not configured and is therefore **absent**, not degraded.

- [ ] **Step 1: Write the failing tests**

```ts
it('is absent when nothing is configured', () => {
  expect(buildWebAuthnConfig({})).toBeNull();
});

it('refuses to boot when enabled without an RP ID', () => {
  expect(() => buildWebAuthnConfig({ MFA_WEBAUTHN_ENABLED: 'true', MFA_WEBAUTHN_ORIGIN: 'https://app.example' }))
    .toThrow(/MFA_WEBAUTHN_RP_ID/);
});

it('refuses to boot when enabled without an origin', () => { /* … */ });

// OAUTH_DEV_ENABLED taught this one: a flag read as a string makes every
// value except the empty one truthy, so "false" enables the thing it names.
it.each([['false', null], ['0', null], ['', null], ['true', 'object']])(
  'reads MFA_WEBAUTHN_ENABLED=%s as a boolean, not a string', (value, expected) => { /* … */ });
```

- [ ] **Step 2: Run, watch fail. Step 3: Implement.** Parse the flag as a boolean by explicit comparison against `'true'`. Refuse with a message naming the missing variable.

- [ ] **Step 4: Run, verify the app actually refuses to boot** (not just the unit): start the dev stack with `MFA_WEBAUTHN_ENABLED=true` and no RP ID, and confirm the container exits. **Check Docker headroom first with `docker run --rm alpine df -h /`; floor is 3 GB.** Commit.

---

### Task 15: WebAuthn — enrollment and login

**Files:**
- Create: `template/apps/backend/src/mfa/webauthn/WebAuthnCeremonies.ts`
- Modify: `template/apps/backend/src/mfa/mfa.controller.ts`, `mfa-verification.service.ts`
- Test: `template/apps/backend/src/mfa/webauthn/__tests__/webauthn.spec.ts`

**Interfaces:**
- Consumes: `buildWebAuthnConfig` (Task 14), `MfaChallengeService` (Task 6).
- Produces: `POST /mfa/webauthn/options`, `POST /mfa/webauthn/verify`.

**The one thing to get right.** These two routes serve both enrollment and login — exactly the shape that produced Phase 4's fail-open. **They must not dispatch on caller input.** Enrollment is the call that arrived with a session; login is the call that arrived with a challenge token. The purpose is fixed by which credential the request carried, and **a request carrying both is refused** — that is a test, not a comment.

- [ ] **Step 1: Write the failing tests**

```ts
it('mints a WEBAUTHN_ENROLLMENT challenge for a session-authenticated caller', async () => { /* … */ });
it('treats a challenge-token caller as a login, never an enrollment', async () => { /* … */ });
it('refuses a request carrying both a session and a challenge token', async () => { /* 400 */ });
it('refuses a LOGIN-purpose challenge presented to the enrollment path', async () => { /* … */ });
it('stores the credential id, public key and counter, and no more', async () => { /* … */ });
it('refuses a credential id already registered to any account', async () => { /* uq_mfa_methods_webauthn_credential */ });
```

- [ ] **Step 2: Run, watch fail. Step 3: Implement** with `@simplewebauthn/server`'s `generateRegistrationOptions` / `verifyRegistrationResponse` / `generateAuthenticationOptions` / `verifyAuthenticationResponse`, storing the ceremony nonce on the `mfa_challenges` row.

**State the limit in the file's TSDoc:** assertion verification is `@simplewebauthn/server`'s, not this template's. What this template owns is the challenge's single use, the purpose's fixity, and the credential's uniqueness — and those are what the tests above cover.

- [ ] **Step 4: Run, inject the fault** (let the route read a `purpose` field from the body), **watch the "never an enrollment" test fail, commit.**

---

### Task 16: Six audit members, and the hand-written map

**Files:**
- Modify: `template/libs/core/src/audit/enums/AuditAction.ts`
- Modify: `template/libs/core/tests/audit/enums/AuditAction.spec.ts`
- Modify: `template/apps/backend/src/mfa/*.ts` (record the entries)

**Interfaces:**
- Produces: `AuditAction` at **39** members — `MFA_METHOD_ADDED`, `MFA_METHOD_REMOVED`, `MFA_CHALLENGE_SUCCEEDED`, `MFA_CHALLENGE_FAILED`, `RECOVERY_CODES_REGENERATED`, `RECOVERY_CODE_CONSUMED`.

- [ ] **Step 1: Add the six members, each with TSDoc saying who the actor is**

For `MFA_CHALLENGE_FAILED` the actor is the account the challenge was minted for — the only account established at that point — and the **reason is recorded and never returned**, as `LOGIN_FAILED` already does.

- [ ] **Step 2: Add all six to the hand-written pinning map, by hand**

The map is transcribed, never derived. A derived expectation cannot fail for the reason the map exists. The compiler catches a rename; nothing but this catches a changed string *value*, and an append-only table written with a value that disagrees with every row already in it is not recoverable.

- [ ] **Step 3: Run the pinning spec, then prove it can fail**

```bash
cd template/libs/core && npx vitest run tests/audit/enums/AuditAction.spec.ts
```

Change one member's string value in `AuditAction.ts` (not the map), re-run, confirm it fails, revert. Record it.

- [ ] **Step 4: Record the entries from the MFA service and commit.**

---

### Task 17: The challenge page — and the meeting point

**Files:**
- Create: `template/apps/webapp/app/pages/mfa/challenge.vue`, `app/components/MfaChallengeForm.vue` (+ stories), `app/composables/useMfa.ts`, `app/services/mfa.{service,fetchers}.ts`
- Modify: `template/apps/webapp/app/stores/auth.ts`, `app/types/api.ts`, `app/i18n/locales/en.json`, `template/apps/webapp/package.json` (add `@simplewebauthn/browser` — the challenge page is the first thing that calls `navigator.credentials`)
- Test: `template/apps/webapp/app/pages/__tests__/mfa-challenge.spec.ts`, `app/stores/__tests__/auth-mfa.spec.ts`

**Read first:** `template/apps/webapp/app/pages/oauth/callback.vue` and its spec — and `phase-4-decision-log.md` on why that page's messages were displayed nowhere.

**Interfaces:**
- Consumes: `POST /auth/login`'s `MFA_REQUIRED` body and `POST /auth/mfa/verify` (Task 9).
- Produces: `/mfa/challenge`.

**The meeting point is the point of this task.** Phase 4 shipped a callback page that rendered all seven refusal messages correctly while `landingUrl` sent the browser somewhere else entirely, so the message behind that phase's central security property was displayed nowhere — invisible because the page's spec asserted the page, the controller's spec asserted the redirect, and **nothing asserted they met**.

- [ ] **Step 1: Write the failing tests — including the join**

```ts
// The two halves, and then the join. The third test is the one Phase 4 lacked.
it('renders each of the five refusals with its own message and remedy', async () => { /* … */ });
it('sends the challenge token and the code to /auth/mfa/verify', async () => { /* … */ });
it('routes to /mfa/challenge when login answers MFA_REQUIRED', async () => {
  // Drive the real login handler with an MFA_REQUIRED response and assert the
  // route the store/page actually navigates to — not a constant either side
  // declares for itself.
  const router = await signInThrough(loginPage, { status: 'MFA_REQUIRED', challengeToken: 't', methods: [] });
  expect(router.currentRoute.value.path).toBe('/mfa/challenge');
});
```

- [ ] **Step 2: Run, watch fail. Step 3: Implement.**

The store learns `MFA_REQUIRED` and holds the challenge token **in memory only** — never a cookie, never the SSR payload. That is the property Phase 3 spent a task establishing for the access credential and it applies here for the same reason.

- [ ] **Step 4: Run the webapp suite, Storybook, and commit**

```bash
cd template/apps/webapp && npx vitest run && npm run build-storybook
```

Storybook must still compile; it was at 615 modules and this task adds to it.

---

### Task 18: The security screen

**Files:**
- Modify: `template/apps/webapp/app/pages/account/security.vue`
- Create: `app/components/{MfaMethodList,TotpEnrollment}.vue` (+ stories), `app/i18n/locales/en.json` entries

- [ ] **Step 1: Write the failing tests** — the list renders enrolled methods; enrollment shows the QR and the secret for manual entry; the recovery codes are shown **once** with an explicit "these will not be shown again"; removing the last method asks for a proof rather than failing silently.
- [ ] **Step 2: Run, watch fail. Step 3: Implement. Step 4: Run the suite and Storybook. Step 5: Commit.**

---

### Task 19: The gates, the docs, and the triage drain

**Files:**
- Modify: `tests/integration/docker.test.mjs`
- Create: `template/docs/adrs/0012-a-second-factor-is-a-property-of-the-account.md`
- Modify: `docs/superpowers/phase-5-decision-log.md`, `docs/superpowers/phase-roadmap.md`
- Modify: whichever triaged-minor files earlier tasks opened

- [ ] **Step 1: Add `/mfa/challenge` to the `FORGE_E2E` dev-webapp walk**

Beside `/` and `/login`, in the loop at `docker.test.mjs:372`. Nothing in this repository made an HTTP request against the dev webapp until Phase 4, and every page of it had returned 500 since Phase 2. **The compose invocation must include the `webapp` service**, which the test's own comment says.

- [ ] **Step 2: Add the Docker TOTP walk**

Against real Postgres: register → verify → enroll TOTP → confirm → log in → assert the response carries **no** access token and the `sessions` count is unchanged → complete the challenge → assert exactly one session now exists. Compute the TOTP code in the test from the secret the enrollment returned.

- [ ] **Step 3: Write ADR-0012**

Why a second factor is a property of the account and not of the way its owner arrived — the argument behind Task 10, in the template's own ADR voice, following `0011-federated-identity-never-auto-links.md`.

- [ ] **Step 4: Drain the triaged minors this phase's files already opened**

Go through the 41-item list in `phase-roadmap.md`. Any item living in a file a Phase 5 task opened is fixed **now**. Items in untouched files stay ledgered. Record the count drained and the count remaining.

- [ ] **Step 5: Run every gate**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
npm test
docker run --rm alpine df -h /   # ≥ 3 GB before the next line
FORGE_E2E=1 npm test
git -C ~/Progetti/Voku status --porcelain   # must be empty
git -C ~/Progetti/Voku rev-parse HEAD       # must be fdfdbdeae2891954dd1cac538a082d5837f281dd
```

- [ ] **Step 6: Write the decision log and update the roadmap**

`phase-5-decision-log.md` gets the full record: the rulings, the plan defects found by implementers, the measurements, what was documented rather than fixed, and the triage. `phase-roadmap.md` marks Phase 5 **BUILT**, records what Phase 6 must not get wrong, and carries forward whatever the flaky-401 investigation concluded.

**Write the log at the end of the phase, after the final review, not before it.** Phase 4's log was committed one commit early and missed the whole-branch review entirely; that content then existed only in a conversation context that was about to be compacted.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "$(cat <<'MSG'
feat(phase-5): the gates, ADR-0012, and the decision log

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```
