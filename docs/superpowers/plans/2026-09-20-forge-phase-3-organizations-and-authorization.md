# Forge Phase 3 — Organizations and Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every generated project ships organizations as tenants, memberships with per-organization roles, email invitations, and a three-layer `can()` that the backend enforces and the webapp renders from.

**Architecture:** Contracts and pure policy in `libs/core`, implemented by both apps, held to one conformance suite per contract with a backend-only suite for what only a server can honestly satisfy (DEC-1). Tenancy is explicit — every scoped query takes an `organizationId` (ADR-0007) — and authorization is one pure function (ADR-0006) whose principal is hydrated from the presented credential's subject, never from the request being judged.

**Tech Stack:** NX monorepo, NestJS + TypeORM + PostgreSQL, Nuxt 4 / Vue 3 + Pinia, `libs/core` framework-agnostic TypeScript, Jest (backend), Vitest (webapp + core), `node --test` (Forge's own tier).

**Spec:** `docs/superpowers/specs/2026-09-17-forge-template-design.md` — §9.4 (organizations and membership), §9.5 (authorization), §9.6 (audit), §9.7 (endpoint surface and migrations), §9.8 (webapp surface), §11 (testing and the D-table).

**Prior art that binds this plan:** `docs/superpowers/phase-roadmap.md` (the ordering decisions and the six findings Phase 2's final review left), `docs/superpowers/phase-2-decision-log.md` (§6 the SSR credential, §7 documented-not-fixed, §8 out-of-phase).

## Global Constraints

- **`~/Progetti/Voku` is read-only.** Never write to it, never run a mutating git command there. Confirm `git -C ~/Progetti/Voku status --porcelain` is empty and HEAD is `fdfdbde` after any task that touches it. This plan requires no reads from it at all.
- **This machine runs unrelated live Docker containers.** Never stop, remove or reconfigure a container you did not create. Docker headroom is `docker run --rm alpine df -h /`, never `docker system df`. Stop and reclaim your own build cache below 3 GB free.
- **`libs/core` stays framework-agnostic.** No framework imports, and no transport vocabulary in prose either — no JWT, cookie, header, HTTP. Enforced by lint and `libs/core/scripts/check-purity.mjs` (D14).
- **`npm run sanitize` must pass before any commit touching `template/`.** Do not weaken a rule to make a commit pass; Task 1 is the one sanctioned change to the gate and it happens before any feature work.
- **The generator takes no dependencies.** `tools/create/` and `tests/` use Node builtins only. Forge's root `package.json` has no `dependencies` and no `devDependencies`.
- **Never add a foreign key to `audit_entries`.** A referential action runs with the table owner's privileges, so any foreign key hands the application a route into a table it has no `UPDATE` or `DELETE` on, voiding D13. See `template/docs/adrs/0009-two-database-roles.md`, which lists this and three more ways to make the revoke decorative while every test stays green.
- **Any wiring this phase adds owes an assertion that fails when it is deleted, plus the evidence of having watched it fail.** In Phase 2, fifteen of sixteen deletions of shipped wiring left the whole backend suite green.
- **Anywhere a driver's expectation and the implementation's answer share a source, the assertion is a tautology.** Compare against the world the host promised, never against what the implementation just returned.
- **Split any new conformance assertion by who can honestly satisfy it (DEC-1).** An assertion only a server can meet belongs in the backend-only security suite. Tenant isolation (D9) is a server property and belongs there from the start.
- **A test must be observed to fail.** Inject the fault, watch the specific test go red, record the command and the output in the task report, then remove the injection. A green suite is not evidence.
- **Node:** `template/package.json` declares `>=22 <23`; both Dockerfiles pin 22. This machine has only v26, so the generated-project gate's Node-mismatch warning is expected to fire on every run. That warning firing is the guard working; it is not coverage of the declared Node.
- **Commit at checkpoints and write reports incrementally.** Three agents stalled mid-verification in Phase 2 with everything uncommitted.

---

## Design rulings made in this plan

These are decided here so that no task re-derives them and no two tasks decide them differently. Each records what it costs if wrong.

### R1 — `Principal` carries memberships and live grants; `can()` keeps its three parameters

ADR-0006 and spec §9.5 fix the signature as `can(principal, permission, resource?)`, and the roadmap says extend `can()`, do not restructure it. So the data the second and third layers need travels on the principal:

```ts
interface Principal {
  userId: UserId;
  platformRole: PlatformRole;
  /** Every organization this person belongs to, and their role in each. */
  memberships: readonly PrincipalMembership[];
  /** The grants that are live as of the caller's clock — see R2. */
  grants: readonly ResourceGrant[];
}
```

**Cost if wrong:** a principal is larger to hydrate than a bare id, so every authorized request pays a membership read. That is the same cost `PlatformAdminGuard` already pays to read `platform_role` from the row rather than the credential, and for the same reason — see R3.

### R2 — Grant expiry is filtered by the hydrator, not evaluated inside `can()`

`ResourceGrant.expiresAt` needs a clock, and a clock inside `can()` would make it impure: the same principal and resource would stop producing the same answer. So `can()` never reads `expiresAt`. Core ships `isGrantLive(grant, now)` as a separate pure policy with its own tests, and `Principal.grants` is documented as "live as of hydration".

**Cost if wrong:** a hydrator that forgets to filter hands `can()` an expired grant and `can()` honours it. That is exactly the shape of an unfailable claim, so it is not left to discipline: Task 15's backend suite asserts that an expired grant is absent from the hydrated principal, and Task 20 watches that assertion fail.

### R3 — The principal is hydrated from the credential's subject, never from the request being judged

`PermissionsGuard` resolves the actor's memberships by `actor.userId` — the subject of the presented credential — and looks up the resource's `organizationId` from the **stored record**. It never reads the organization out of the route parameter to build the principal.

This is the riskiest thing in the phase. Hydrate from the `:organizationId` route parameter and `can()` compares the request's organization against itself, always agrees, and D9 — tenant isolation — passes without testing anything. It is Phase 2's signature defect one level up: a claim whose subject has no test is a claim about nothing.

**Cost if wrong:** silent cross-tenant data access, with a green suite. Task 20 injects exactly this fault and must watch D9 go red.

### R4 — Nothing that feeds `can()` goes in the access credential

Memberships and grants are read per request. Phase 2's access credential lives `ACCESS_TOKEN_TTL_SECONDS` and is not re-minted when anything changes, so a membership or grant copied into it would stay live for that whole window after being revoked — and D12 ("a `ResourceGrant` revoked mid-session → next request denied, no stale cache") would be unsatisfiable by construction. `JwtStrategy.validate` continues to return `{ userId, sessionId }` and nothing more.

**Cost if wrong:** D12 cannot be made to pass without reshaping the session design, which is Phase 2 work.

### R5 — `audit_entries.organization_id` becomes `uuid`, and still carries no foreign key

Phase 2 created it as `text NULL` because core had no `OrganizationId` to brand it with. Task 9 alters it to `uuid` with `USING organization_id::uuid`, which is safe because no shipped code has ever written a non-null value into it. It gains **no** foreign key to `organizations` — see the Global Constraints and ADR-0009. The temptation to add one arrives precisely now, which is why the constraint is repeated here.

**Cost if wrong:** D13 becomes decorative while every test stays green.

---

### Running the gates — you cannot run them inside `template/`

Discovered during execution, after every task had been written assuming otherwise. `template/package.json` is `"name": "__FORGE_NAME__"` and `template/libs/core/package.json` is `"name": "__FORGE_SCOPE__/core"` — the tree carries unsubstituted tokens by design, so `npm install` inside it fails and `npx nx` has nothing to run. **Twenty-three commands in the original draft of this plan were wrong this way.**

Every gate runs against a freshly generated probe project:

```bash
cd /Users/sinisimattia/Progetti/forge
PROBE=$(mktemp -d)/probe
node tools/create/index.mjs --name gateapp --out "$PROBE" --yes --no-git
cd "$PROBE" && npm ci
```

`$PROBE` in every command below means that directory. Two consequences that matter:

- **You edit `template/`, you verify in `$PROBE`.** A probe is a copy: regenerate it after every change you want to test. Never fix a bug by editing the probe — the edit is thrown away and the real defect ships.
- **Probes are disposable and they are not small.** Delete each one when you are done with it. Phase 1 and Phase 2 between them leaked 23 GB across 2,624 abandoned `forge-*` directories and another 9.2 GB of generated projects; that is the failure mode, and `mktemp -d` plus a delete at the end of the task is what avoids repeating it.

Forge's own suites are the exception — `npm test` and `npm run sanitize` run from the repo root and need no probe.

---

### Core test conventions — verified against the shipped config, correcting this plan

Discovered during execution, after Tasks 3–7 had been written against wrong assumptions. Every core task must follow these; the earlier drafts of this plan did not.

- **`libs/core` runs jest, not vitest.** `libs/core/package.json` → `"test": "jest"`, `"test:coverage": "jest --coverage"`, and `libs/core/jest.config.js` is the config.
- **Core tests live in `libs/core/tests/`, mirroring `src/`'s domain structure — NOT co-located in `src/**/__tests__/`.** `testMatch` is `['<rootDir>/tests/**/*.spec.ts']`. A spec written under `src/` is never executed, which is this phase's signature defect authored into its own plan.
- **Tests import through core's own subpaths**, not relative paths: `import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';`. `moduleNameMapper` maps `^__FORGE_SCOPE__/core/(.*)$` to `<rootDir>/src/$1/index.ts`, so tests exercise source and a new domain needs no config edit — but it also means **a test cannot import a symbol the domain's barrel does not export**.
- **`describe`/`it`/`expect` are jest globals.** No import line.
- **Coverage excludes** barrels, `types/**`, `contracts/**`, `testing/*ContractDeps.ts`, `ConformanceExpect.ts` and `ConformanceRunner.ts` — they emit no runtime JS. Conformance suites (`testing/run*.ts`) ARE covered, which is why Task 5's reference implementation exists.
- **Conformance suites are driven through `jestConformanceExpect`** (`libs/core/tests/shared/testing/jestConformanceExpect.ts`) and an in-memory implementation beside the spec, e.g. `tests/auth/testing/InMemoryAuthService.ts`. Read `tests/auth/testing/runIAuthServiceContract.spec.ts` for the exact shape before writing Task 5's.

---

## File structure

New files, and the one responsibility each carries.

### `template/libs/core/src/organizations/`

| File | Responsibility |
|---|---|
| `entities/Organization.ts` | the tenant; name/slug invariants |
| `entities/Membership.ts` | binds a user to an organization with a role |
| `entities/Invitation.ts` | a single-use, expiring offer of a role at an address |
| `enums/OrgRole.ts` | `OWNER \| ADMIN \| MEMBER \| VIEWER` |
| `enums/InvitationStatus.ts` | `PENDING \| ACCEPTED \| REVOKED` — expiry is derived from `expiresAt`, never stored |
| `types/OrganizationId.ts`, `MembershipId.ts`, `InvitationId.ts` | branded ids |
| `types/OrganizationProps.ts`, `OrganizationJSON.ts` | construction and wire shapes |
| `types/MembershipProps.ts`, `MembershipJSON.ts` | as above |
| `types/InvitationProps.ts`, `InvitationJSON.ts` | as above |
| `types/CreateOrganizationInput.ts`, `UpdateOrganizationInput.ts`, `InviteMemberInput.ts` | the three inputs that are not a single scalar |
| `types/OrganizationQuery.ts`, `MemberQuery.ts`, `InvitationQuery.ts` | paging shapes |
| `errors/*.ts` | eight domain errors, listed in Task 3 and Task 4 |
| `contracts/IOrganizationService.ts` | the whole tenancy surface |
| `testing/IOrganizationServiceContractDeps.ts`, `organization-fixtures.ts`, `runIOrganizationServiceContract.ts` | the shared suite both apps are driven through |

### `template/libs/core/src/authorization/` (extended)

| File | Responsibility |
|---|---|
| `types/Permission.ts` | widened from three members to sixteen |
| `types/Principal.ts` | gains `memberships` and `grants`; `OwnedResource` becomes `Resource` |
| `types/ResourceGrant.ts` | the layer-three exception record |
| `types/ResourceType.ts` | what a grant can be about |
| `policies/ROLE_PERMISSIONS.ts` | `Record<OrgRole, readonly Permission[]>` |
| `policies/isGrantLive.ts` | the pure expiry rule R2 keeps out of `can()` |
| `policies/can.ts` | extended to three layers, in order |
| `contracts/IAuthorizationService.ts` | reading and writing grants |
| `testing/*` | the grant suite |

### `template/apps/backend/src/`

| File | Responsibility |
|---|---|
| `db/migrations/1758000003000-OrganizationsAndAuthorization.ts` | four tables, the `audit_entries` column change, no foreign key on it |
| `organizations/organization-record.entity.ts`, `membership-record.entity.ts`, `invitation-record.entity.ts` | rows |
| `organizations/to-organization.ts`, `to-membership.ts`, `to-invitation.ts` | row → entity, one place each |
| `organizations/organizations.{module,controller,service}.ts` | organization CRUD |
| `organizations/members.controller.ts` | membership listing, role change, removal |
| `organizations/invitations.controller.ts` | issue, list, revoke, accept |
| `authorization/resource-grant-record.entity.ts` | rows |
| `authorization/principal.service.ts` | **R3** — hydrates a `Principal` from a `UserId` |
| `authorization/permissions.guard.ts`, `require-permission.decorator.ts` | enforcement |
| `authorization/grants.controller.ts`, `authorization.{module,service}.ts` | grant surface |
| `mail/templates/organization-invitation.ts` | the invitation mail |

### `template/apps/webapp/app/`

| File | Responsibility |
|---|---|
| `services/organization.service.ts`, `authorization.service.ts` | the contracts over the wire |
| `fetchers/organization.fetchers.ts`, `authorization.fetchers.ts` | transport |
| `stores/organization.ts` | the active organization |
| `composables/useOrganization.ts`, `useCan.ts`, `useInvitations.ts` | screen-facing |
| `middleware/permission.ts` | route-level authorization |
| `plugins/auth-init.client.ts` | **decision log §6** — renews on hydration once the credential leaves the SSR payload |
| `pages/organizations/*.vue`, `pages/invitations/[token].vue` | the six screens §9.8 names |
| `components/organisms/{MemberList,InvitationList,OrganizationSwitcher,GrantList}.vue` | with stories and `en` strings |

---

## Task index

| # | Task | Band |
|---|---|---|
| 1 | The sanitize gate admits the template's own invitation vocabulary | pre-flight |
| 2 | Three guards Phase 2's review found inert | pre-flight |
| 3 | `organizations/` — Organization, Membership, and the core subpath wiring | core |
| 4 | `organizations/` — Invitation | core |
| 5 | `IOrganizationService` and its conformance suite | core |
| 6 | Authorization layer two — `Permission`, `ROLE_PERMISSIONS`, `can()` | core |
| 7 | Authorization layer three — `ResourceGrant`, `isGrantLive`, `IAuthorizationService` | core |
| 8 | The audit surface tenancy finally gives a subject | core |
| 9 | Persistence — four tables, the `audit_entries` column change, the record classes | backend |
| 10 | Organizations — service, controller, module | backend |
| 11 | Members — listing, role change, removal, and the last-owner invariant | backend |
| 12 | Invitations — issue, revoke, accept, and the mail | backend |
| 13 | `PrincipalService`, `PermissionsGuard`, `@RequirePermission` | backend |
| 14 | Grants, and the organization-scoped audit read | backend |
| 15 | Backend conformance drivers and the tenant-isolation security suite | backend |
| 16 | Webapp services, fetchers and conformance adapters | webapp |
| 17 | The organization store, `useCan`, and the `permission` middleware | webapp |
| 18 | Pages, components, stories and locale strings | webapp |
| 19 | The access credential leaves the SSR payload | webapp |
| 20 | D9, D12, D15 — and watching each one fail | gates |
| 21 | The Docker end-to-end tenancy walk | gates |
| 22 | Fix wave, ADRs, decision log, roadmap | close |

---

## Task 1: The sanitize gate admits the template's own invitation vocabulary

Spec §9.4 makes invitations a first-class concept in every generated project. Three rules in `tools/sanitize.mjs` ban the vocabulary the template is about to use legitimately. This is the one sanctioned change to the gate this phase makes, and it happens **before** any feature task so that no feature commit is ever the reason a rule was weakened.

**Files:**
- Modify: `tools/sanitize.mjs:228` (source-domain term), `:251` (source-domain constant), `:252` (source-domain module)
- Test: `tests/unit/sanitize.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a gate that tolerates `Invitation`, `invitations.service.ts` and `INVITATION_ACCEPTED`. Every later task depends on this, because `npm run sanitize` gates every commit touching `template/`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/sanitize.test.mjs`, following the file's own convention of asserting both directions:

```javascript
// Spec §9.4 makes organization invitations a first-class concept in every generated
// project, so the gate can no longer treat the noun as evidence of a leak. What it must
// still catch is the shape a leak actually takes — a domain compound — which for this
// concept is the qualifier in front of it, not the word itself.
test('the template\'s own invitation vocabulary is admitted', () => {
  assert.equal(flagged('export class Invitation {', TS), false);
  assert.equal(flagged("import { InvitationsService } from './invitations.service';", TS), false);
  assert.equal(flagged('  INVITATION_ACCEPTED = \'INVITATION_ACCEPTED\',', TS), false);
  assert.equal(flagged('apps/backend/src/organizations/invitations.controller.ts'), false);
});

// The narrowing above must not become a hole. A source-project trace is still a trace
// wherever it appears, including on a line that also says "invitation".
test('a source-project trace on an invitation line is still flagged', () => {
  assert.equal(labels('// see voku for the original invitation flow', TS), 'source-project trace');
});
```

Note `flagged('…/invitations.controller.ts')` is called with one argument — `pathFindings` is what judges a path, and the helper at the top of the file delegates to `lineFindings`. Add a `pathFlagged` helper beside the existing ones rather than overloading `flagged`:

```javascript
const pathFlagged = (p) => pathFindings(p).length > 0;
```

and use it for the path case.

- [ ] **Step 2: Run it to watch it fail**

```bash
cd /Users/sinisimattia/Progetti/forge && node --test tests/unit/sanitize.test.mjs
```

Expected: the first new test fails on the `Invitation` line, reported as `source-domain term`. Record the exact output in the report — this is the evidence that the rules being changed are the rules that were blocking.

- [ ] **Step 3: Narrow the three rules**

In `tools/sanitize.mjs`, remove `invitations?` from the source-domain term rule:

```javascript
  ['source-domain term', /\b(rsvp|stripe|organizers?|refunds?)\b/i],
```

Remove `INVITATION` from the constant rule:

```javascript
  ['source-domain constant', /\b(EVENT|PAYMENT|TICKET|REFUND)_/],
```

Remove `invitation` from the module rule:

```javascript
  ['source-domain module', /\b(event|payment|ticket)s?\.(module|service|controller|entity|repository|guard|dto|resolver|interceptor|pipe|strategy|gateway)\b/i],
```

Replace the comment above the term rule with one that records why the concept left it, so the next reader does not "restore" it:

```javascript
  // Terms with no innocent generic use — always a leak.
  //
  // `invitation` was here and is deliberately gone. Spec §9.4 makes organization
  // invitations a first-class concept of the template itself: `Invitation`,
  // `invitations.controller.ts` and `INVITATION_ACCEPTED` are all things a generated
  // project is supposed to contain. A rule that bans a word the template uses is not a
  // gate, it is a rule everyone learns to route around, and the routing-around is what
  // actually costs — it teaches that a sanitize failure is something you argue with.
  //
  // What still catches a leak of this concept is `source-project trace` (/voku/i), which
  // is unconditional and matches on the same line whatever else is on it. The qualifier
  // in front of the noun is where a domain shows itself, and no qualifier this template
  // uses is shared with the source project's.
```

- [ ] **Step 4: Run the whole unit tier and the gate itself**

```bash
cd /Users/sinisimattia/Progetti/forge && node --test tests/unit/ && npm run sanitize
```

Expected: every test passes, including the two new ones and the existing `a leaked domain name is flagged in the shapes it actually takes`. `npm run sanitize` reports clean with exactly one exemption (`template/.github/workflows/ci.yml:40`).

- [ ] **Step 5: Verify the narrowing did not widen anything else**

```bash
cd /Users/sinisimattia/Progetti/forge && node -e "
import('./tools/sanitize.mjs').then(({ lineFindings }) => {
  for (const line of ['const eventId = 1;', 'class PaymentService {}', 'TICKET_ISSUED = 1', 'rsvp()', 'organizers']) {
    console.log(JSON.stringify(line), '->', lineFindings(line, 'x.ts'));
  }
});
"
```

Expected: every one of the five still reports a finding. This is the check that the edit removed one concept rather than damaging the alternation it sat in.

- [ ] **Step 6: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge && git add tools/sanitize.mjs tests/unit/sanitize.test.mjs && git commit -m "chore(forge): let the sanitize gate admit the template's own invitation vocabulary

Spec 9.4 makes organization invitations a first-class concept of every generated
project, so three rules banned vocabulary the template is about to use: the bare
noun, INVITATION_ as a constant prefix, and invitations.<module|service|...>.

Narrowed in its own commit, before any Phase 3 feature work, so that no feature
commit is ever the reason a gate rule was weakened. The unconditional
source-project trace rule is untouched and still matches on an invitation line."
```

---

## Task 2: Three guards Phase 2's review found inert

Phase 2's final review returned MERGE with six findings. Three are the same shape — *a check that passes because it never ran* — and one of them is ordering-critical: Phase 3 adds thirteen `Permission` members and a four-member `OrgRole`, and the exhaustive switch is the forcing function that is supposed to make each one loud. Fix it after those members land and the compile errors that should have fired never do.

**Files:**
- Modify: `template/apps/webapp/app/stores/auth.ts:229`, `template/apps/webapp/app/components/organisms/LoginForm.vue:63`
- Modify: `template/.github/workflows/ci.yml`, `template/libs/core/project.json`
- Modify: `template/apps/webapp/scripts/check-atomic-layers.mjs:169-172`
- Test: `template/apps/webapp/app/components/__tests__/LoginForm.spec.ts`, `template/apps/webapp/scripts/__tests__/check-atomic-layers.spec.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `AuthenticationOutcome` consumers that fail to compile when a status member is added. Task 6 relies on the same discipline for `Permission`.

**Correction to the roadmap:** it names three webapp consumers of `AuthenticationOutcome`. There are two that branch on the status — `stores/auth.ts:229` and `LoginForm.vue:63`. `composables/useAuth.ts` declares `Promise<AuthenticationOutcome>` and passes the value through without inspecting it, so it needs no change. Verify this before editing; if a third branching consumer has appeared, it gets the same treatment.

- [ ] **Step 1: Watch the forcing function fail to fire**

Add a fourth member to `AuthenticationStatus` temporarily:

```bash
cd "$PROBE" && sed -i '' "s/^}/  MFA_REQUIRED = 'MFA_REQUIRED',\n}/" libs/core/src/auth/enums/AuthenticationStatus.ts && npx nx run-many -t typecheck -p core backend webapp
```

Expected, and this is the finding being fixed: `core` and `backend` fail with TS2345 `'never'`, and **`webapp` passes**. Record all three results. Then revert:

```bash
cd /Users/sinisimattia/Progetti/forge && git checkout template/libs/core/src/auth/enums/AuthenticationStatus.ts
```

- [ ] **Step 2: Make both webapp consumers exhaustive**

In `template/apps/webapp/app/stores/auth.ts`, replace the `if` at line 229 with a switch whose default calls `assertNever`. The store's `login` returns the outcome to its caller, so the branch that is not `AUTHENTICATED` returns it unchanged:

```ts
    switch (outcome.status) {
      case AuthenticationStatus.AUTHENTICATED:
        break;
      case AuthenticationStatus.REJECTED:
        // A refusal is not an error and is not a state change: somebody who was
        // signed in stays signed in when a re-authentication is refused.
        return outcome;
      default:
        // Reachable only from outside the type system. A status member added
        // without a branch here is a compile error, which is the whole point:
        // Phase 5 adds MFA_REQUIRED, and rendering it as a sign-in refusal would
        // be silent and wrong.
        return assertNever(outcome.status);
    }
```

Import `assertNever` from `__FORGE_SCOPE__/core/shared/policies`. Apply the same shape in `LoginForm.vue:63`. Preserve each site's existing behaviour exactly — this is a change to what the compiler checks, not to what the code does.

- [ ] **Step 3: Watch it fire**

Re-run Step 1's injection. Expected now: all three of `core`, `backend` and `webapp` fail typecheck. Record the webapp's error text, which is the evidence. Revert the injection.

- [ ] **Step 4: Put `libs/core`'s coverage thresholds in a CI tier**

`libs/core` declares 100/100/100/100 in `jest.config.js` and **no CI runs it**. Corrected during execution: a `coverage` target already exists in `template/libs/core/project.json` (it runs `npm run test:coverage`, i.e. `jest --coverage`) — the gap is only that nothing invokes it. Add it to the `unit` tier in `template/.github/workflows/ci.yml` so it runs on every push rather than only on a pull request. Do not add a target that already exists, and do not switch the runner.

Verify the thresholds are real before wiring them, and that the wiring is real after:

```bash
cd "$PROBE" && npx nx run core:coverage
```

Expected: passes at 100% on all four axes. Then delete one branch of `can()`'s switch, re-run, and watch it fail the threshold. Restore.

- [ ] **Step 5: Guard the layer checker's second axis**

`check-atomic-layers.mjs:169-172` guards the mirror case only. With `app/pages` and `app/layouts` moved aside it prints `clean (44 component(s) and 0 page(s)/layout(s) checked)` and exits 0. Extend the vacuous-pass guard to cover the axis Task 17 of Phase 2 added:

```javascript
if (files.length === 0 || components === 0 || routed === 0) {
  console.error(
    'Atomic layering: FAILED — nothing was scanned on at least one axis. '
    + `components=${components}, pages/layouts=${routed}. `
    + 'A checker that finds nothing to check reports clean, which reads as evidence.',
  );
  process.exit(1);
}
```

- [ ] **Step 6: Watch that guard fail**

```bash
cd "$PROBE/apps/webapp" && mv app/pages /tmp/pages-aside && mv app/layouts /tmp/layouts-aside && node scripts/check-atomic-layers.mjs; echo "EXIT=$?"; mv /tmp/pages-aside app/pages && mv /tmp/layouts-aside app/layouts
```

Expected: `EXIT=1` with the new message. Before the fix this printed clean and exited 0 — run it both ways and record both.

- [ ] **Step 7: Run every gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test -p core backend webapp && cd /Users/sinisimattia/Progetti/forge && npm run sanitize
```

```bash
cd /Users/sinisimattia/Progetti/forge && git add -A template/ && git commit -m "fix(template): make three inert guards able to fail

Each was found by Phase 2's final whole-branch review and each is the same
shape — a check that passes because it never ran.

- AuthenticationOutcome's assertNever forcing function did not reach the webapp:
  injecting a fourth status member failed core and backend typecheck and the
  webapp passed, so a new member would have rendered as a sign-in refusal,
  silently. Both branching consumers are now exhaustive. Phase 3 adds thirteen
  Permission members, so this had to land first.
- libs/core's 100% coverage thresholds ran in no CI at all.
- The layer checker printed clean with zero pages scanned."
```

---

## Task 3: `organizations/` — Organization, Membership, and the core subpath wiring

**Files:**
- Create: `template/libs/core/src/organizations/entities/{Organization,Membership,index}.ts`
- Create: `template/libs/core/src/organizations/enums/{OrgRole,index}.ts`
- Create: `template/libs/core/src/organizations/types/{OrganizationId,MembershipId,OrganizationProps,OrganizationJSON,MembershipProps,MembershipJSON,CreateOrganizationInput,UpdateOrganizationInput,OrganizationQuery,MemberQuery,index}.ts`
- Create: `template/libs/core/src/organizations/errors/{OrganizationNotFoundError,OrganizationNameRequiredError,InvalidOrganizationSlugError,MembershipNotFoundError,AlreadyAMemberError,LastOwnerError,index}.ts`
- Modify: `template/libs/core/package.json` — four new `exports` subpaths
- Test: `template/libs/core/tests/organizations/entities/{Organization,Membership}.spec.ts`

**Interfaces:**
- Consumes: `Brand` from `shared/types`, `DomainError` from `shared/errors`, `UserId` from `users/types`.
- Produces:
  - `type OrganizationId = Brand<string, 'OrganizationId'>`, `type MembershipId = Brand<string, 'MembershipId'>`
  - `enum OrgRole { OWNER = 'OWNER', ADMIN = 'ADMIN', MEMBER = 'MEMBER', VIEWER = 'VIEWER' }`
  - `class Organization` with `readonly id: OrganizationId; name: string; slug: string; createdAt: Date; updatedAt: Date; deletedAt: Date \| null`, `get isDeleted(): boolean`, `toJSON(): OrganizationJSON`, `static fromJSON(json: OrganizationJSON): Organization`
  - `class Membership` with `readonly id: MembershipId; organizationId: OrganizationId; userId: UserId; role: OrgRole; createdAt: Date; updatedAt: Date`, `get isOwner(): boolean`, `toJSON()`, `static fromJSON()`
  - Subpaths `__FORGE_SCOPE__/core/organizations/{entities,enums,types,errors}`

Tasks 4–8, 9–16 all import from these subpaths.

- [ ] **Step 1: Write the failing entity tests**

`template/libs/core/tests/organizations/entities/Organization.spec.ts`:

```ts
// jest globals — core's runner is jest (libs/core/jest.config.js); no import.
import { Organization } from '../Organization';
import { InvalidOrganizationSlugError } from '../../errors/InvalidOrganizationSlugError';
import { OrganizationNameRequiredError } from '../../errors/OrganizationNameRequiredError';
import type { OrganizationId } from '../../types/OrganizationId';

const props = {
  id: 'a3f1c2d4-0000-4000-8000-000000000001' as OrganizationId,
  name: '  Acme Works  ',
  slug: 'acme-works',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
};

describe('Organization', () => {
  it('trims the name, because the name is what a person reads', () => {
    expect(new Organization(props).name).toBe('Acme Works');
  });

  it('refuses a name that is only whitespace', () => {
    expect(() => new Organization({ ...props, name: '   ' })).toThrow(OrganizationNameRequiredError);
  });

  // The slug is not derived from the name here, and that is the decision this
  // test records. Deriving it would make two organizations named "Acme Works"
  // collide on a value neither of them chose, and would make renaming an
  // organization silently change every URL that names it. The caller supplies
  // it; the entity only refuses one that cannot be in a path.
  it('refuses a slug that is not usable in a path', () => {
    for (const bad of ['Acme Works', 'acme_works', 'acme works', '-acme', 'acme-', '', 'ACME']) {
      expect(() => new Organization({ ...props, slug: bad }), bad).toThrow(InvalidOrganizationSlugError);
    }
  });

  it('accepts the slugs a generated project will actually produce', () => {
    for (const good of ['acme', 'acme-works', 'a1', 'acme-works-2']) {
      expect(new Organization({ ...props, slug: good }).slug).toBe(good);
    }
  });

  it('round-trips through its wire shape with every instant revived', () => {
    const original = new Organization(props);
    const revived = Organization.fromJSON(original.toJSON());
    expect(revived.createdAt).toBeInstanceOf(Date);
    expect(revived.createdAt.toISOString()).toBe(props.createdAt.toISOString());
    expect(revived.toJSON()).toEqual(original.toJSON());
  });

  it('reports a soft delete', () => {
    expect(new Organization(props).isDeleted).toBe(false);
    expect(new Organization({ ...props, deletedAt: new Date() }).isDeleted).toBe(true);
  });
});
```

`Membership.spec.ts` asserts: `isOwner` is true for `OrgRole.OWNER` and false for the other three (loop over the enum's members rather than listing three literals, so a fifth role added later is covered); the wire round-trip revives both instants; and the ids survive as their branded values.

- [ ] **Step 2: Run to verify they fail**

```bash
cd "$PROBE" && npx nx test core -- tests/organizations
```

Expected: FAIL, cannot resolve `../Organization`.

- [ ] **Step 3: Write the enums, branded ids, props and JSON shapes**

Follow `libs/core/src/users/` exactly — read `users/types/UserId.ts`, `UserProps.ts`, `UserJSON.ts` and `users/enums/PlatformRole.ts` and mirror their structure, TSDoc density and barrel style. The substantive content:

```ts
// enums/OrgRole.ts
/**
 * What somebody may do inside one organization.
 *
 * A role is a property of a *membership*, never of a user: the same person can
 * be an OWNER of one organization and a VIEWER of another, which is exactly why
 * spec §9.4 keeps roles off `User`. `User.platformRole` is a different axis
 * entirely — it is about operating the deployment — and is never implied by any
 * role here.
 *
 * Ordered most to least powerful in the declaration, but **nothing reads that
 * order**. Permissions come from `ROLE_PERMISSIONS`, an explicit map, because a
 * comparison against declaration order silently re-ranks every role the day a
 * member is inserted in the middle.
 */
export enum OrgRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}
```

`OrganizationProps` carries `{ id, name, slug, createdAt, updatedAt, deletedAt }`; `MembershipProps` carries `{ id, organizationId, userId, role, createdAt, updatedAt }`. The JSON shapes are identical with instants as `string`. `CreateOrganizationInput` is `{ name: string; slug: string }`, `UpdateOrganizationInput` is `{ name?: string; slug?: string }`. `OrganizationQuery` and `MemberQuery` each carry `{ page: number; limit: number }`; `MemberQuery` adds `role?: OrgRole`.

- [ ] **Step 4: Write the six errors**

Mirror `libs/core/src/users/errors/UserNotFoundError.ts` — each extends `DomainError`. **Corrected during execution: core errors carry NO `code` property.** `DomainError` sets `this.name = new.target.name` and that class name is the stable identifier; the `code` field this plan originally called for exists only in the backend's HTTP envelope, which its exception filter produces from the error class. Name the six classes `OrganizationNotFoundError`, `OrganizationNameRequiredError`, `InvalidOrganizationSlugError`, `MembershipNotFoundError`, `AlreadyAMemberError`, `LastOwnerError`. `LastOwnerError`'s message states the invariant it protects: an organization always has at least one `OWNER`, so the last one can neither leave nor be demoted (spec §9.4).

- [ ] **Step 5: Write the two entities**

`Organization` mirrors `User`'s structure — validate in the constructor, store normalized, expose `toJSON`/`fromJSON`. The slug rule:

```ts
  /**
   * A slug this project is willing to put in a path.
   *
   * Lowercase letters, digits and single hyphens, never leading or trailing.
   * Deliberately narrower than what a URL permits: the value ends up in
   * `/organizations/<slug>` and in mail links, and a slug that needs escaping in
   * either is a slug that will eventually be escaped differently in the two.
   *
   * The entity does **not** derive this from the name. Two organizations called
   * "Acme Works" would collide on a value neither chose, and a rename would
   * silently change every URL naming the old one. The caller supplies it; this
   * only refuses one that cannot be in a path.
   */
  private static readonly SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
```

`Membership` validates nothing beyond what its types already guarantee — and that is worth a comment saying so, because an entity with no invariants looks like an oversight:

```ts
/**
 * Binds one person to one organization with one role.
 *
 * It enforces no invariant of its own, and that is not an omission. Every rule
 * about memberships is a rule about a *set* of them — an organization always has
 * at least one OWNER, a person is a member of an organization at most once — and
 * a single entity cannot see the set it belongs to. Those rules live in
 * `IOrganizationService`'s contract and are asserted by its conformance suite,
 * where the world that makes them checkable exists.
 */
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd "$PROBE" && npx nx test core -- tests/organizations
```

- [ ] **Step 7: Wire the four subpaths**

Add to `template/libs/core/package.json` `exports`, in the alphabetical position the file already uses:

```json
    "./organizations/entities": {
      "types": "./dist/organizations/entities/index.d.ts",
      "default": "./dist/organizations/entities/index.js"
    },
    "./organizations/enums": { "...": "..." },
    "./organizations/errors": { "...": "..." },
    "./organizations/types": { "...": "..." },
```

(Write each of the four out in full — the `"...": "..."` above is shorthand for this plan only.)

The generated-project gate checks `exports` against the barrels **in both directions**, so a subpath with no `index.ts` and a barrel with no subpath both fail. Verify:

```bash
cd /Users/sinisimattia/Progetti/forge && node --test tests/integration/generated-project.test.mjs 2>&1 | grep -i "export\|barrel"
```

- [ ] **Step 8: Run every core gate**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test coverage -p core && node libs/core/scripts/check-purity.mjs
```

Expected: all pass, coverage still 100/100/100/100 (Task 2 made that a gate), purity clean. If coverage drops, the new code has an unreached branch — add the case, do not lower the threshold.

- [ ] **Step 9: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "feat(core): Organization and Membership, with OrgRole on the membership

A role is a property of a membership and never of a user (spec 9.4): the same
person is an OWNER of one organization and a VIEWER of another, which is why
roles are not a field on User.

Membership enforces no invariant of its own, deliberately — every rule about
memberships is a rule about a set of them, and those live in the contract."
```

---

## Task 4: `organizations/` — Invitation

Spec §9.4: invitations are email-based, single-use, expiring, and carry the intended role. Accepting one while signed out routes through registration and then consumes the invitation.

**Files:**
- Create: `template/libs/core/src/organizations/entities/Invitation.ts`
- Create: `template/libs/core/src/organizations/enums/InvitationStatus.ts`
- Create: `template/libs/core/src/organizations/types/{InvitationId,InvitationProps,InvitationJSON,InviteMemberInput,InvitationQuery}.ts`
- Create: `template/libs/core/src/organizations/errors/{InvitationNotFoundError,InvitationNoLongerOpenError,InvitationAddressMismatchError}.ts`
- Modify: the four barrels from Task 3
- Test: `template/libs/core/tests/organizations/entities/Invitation.spec.ts`

**Interfaces:**
- Consumes: `OrgRole`, `OrganizationId` (Task 3); `normalizeEmail` from `shared/policies`; `UserId`.
- Produces:
  - `enum InvitationStatus { PENDING = 'PENDING', ACCEPTED = 'ACCEPTED', REVOKED = 'REVOKED' }`
  - `class Invitation` with `readonly id: InvitationId; organizationId: OrganizationId; email: string; role: OrgRole; status: InvitationStatus; invitedByUserId: UserId; expiresAt: Date; createdAt: Date; acceptedAt: Date | null; acceptedByUserId: UserId | null`
  - `isExpiredAt(now: Date): boolean` and `isOpenAt(now: Date): boolean` — **both take the instant**
  - `InviteMemberInput = { email: string; role: OrgRole }`

- [ ] **Step 1: Write the failing test**

```ts
// jest globals — core's runner is jest (libs/core/jest.config.js); no import.
import { Invitation } from '../Invitation';
import { InvitationStatus } from '../../enums/InvitationStatus';
import { OrgRole } from '../../enums/OrgRole';

const AT = (iso: string) => new Date(iso);
const props = {
  id: '…' as InvitationId,
  organizationId: '…' as OrganizationId,
  email: '  Ada@Example.COM ',
  role: OrgRole.MEMBER,
  status: InvitationStatus.PENDING,
  invitedByUserId: '…' as UserId,
  expiresAt: AT('2026-02-01T00:00:00.000Z'),
  createdAt: AT('2026-01-25T00:00:00.000Z'),
  acceptedAt: null,
  acceptedByUserId: null,
};

describe('Invitation', () => {
  it('holds the address in normal form, so a lookup by address finds it', () => {
    expect(new Invitation(props).email).toBe('ada@example.com');
  });

  // Expiry is derived from the instant, never stored as a status. A stored
  // EXPIRED would be a fact that becomes true while nothing is running, so every
  // read would have to repair the row before trusting it — and the read path is
  // exactly where that repair gets forgotten.
  it('derives expiry from the instant it is asked about', () => {
    const invitation = new Invitation(props);
    expect(invitation.isExpiredAt(AT('2026-01-31T23:59:59.000Z'))).toBe(false);
    expect(invitation.isExpiredAt(AT('2026-02-01T00:00:00.000Z'))).toBe(true);
    expect(invitation.isExpiredAt(AT('2026-02-02T00:00:00.000Z'))).toBe(true);
  });

  // The boundary is worth pinning in both directions: `expiresAt` is the first
  // instant at which it is expired, not the last at which it is open.
  it('is open only while PENDING and unexpired', () => {
    const before = AT('2026-01-26T00:00:00.000Z');
    expect(new Invitation(props).isOpenAt(before)).toBe(true);
    expect(new Invitation(props).isOpenAt(AT('2026-03-01T00:00:00.000Z'))).toBe(false);
    for (const status of [InvitationStatus.ACCEPTED, InvitationStatus.REVOKED]) {
      expect(new Invitation({ ...props, status }).isOpenAt(before), status).toBe(false);
    }
  });

  it('round-trips through its wire shape', () => {
    const original = new Invitation(props);
    expect(Invitation.fromJSON(original.toJSON()).toJSON()).toEqual(original.toJSON());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd "$PROBE" && npx nx test core -- tests/organizations/entities/Invitation.spec.ts
```

- [ ] **Step 3: Write `InvitationStatus`, with the reason expiry is absent from it**

```ts
/**
 * Where an invitation stands, as a fact somebody recorded.
 *
 * **There is no EXPIRED member, deliberately.** Expiry is a function of
 * `expiresAt` and the instant you ask — a fact that becomes true while nothing
 * is running. Storing it as a status would mean every read had to repair the row
 * before trusting it, and the read path is precisely where that repair gets
 * forgotten. `Invitation.isOpenAt(now)` is the question every caller actually
 * has, and it answers both halves.
 */
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
}
```

- [ ] **Step 4: Write the entity**

Normalize `email` with `normalizeEmail` and refuse a blank one (reuse `users/errors/EmailRequiredError`). Both predicates take `now`:

```ts
  /**
   * Whether this invitation has lapsed as of `now`.
   *
   * The instant is a parameter and not `new Date()`, which is the same rule
   * `can()` follows and for the same reason: an entity that reads a clock
   * returns a different answer for the same inputs, so nothing about it can be
   * asserted without controlling time. `expiresAt` is the first instant at which
   * it is expired, not the last at which it is open.
   */
  isExpiredAt(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }
```

The three errors mirror Task 3's shape. `InvitationNoLongerOpenError` covers revoked, already-accepted and expired **as one error** — spec §9.4 makes an invitation single-use, and telling an unauthenticated caller which of the three it was distinguishes "this token was real once" from "this token never existed". Say that in its TSDoc.

- [ ] **Step 5: Run the tests, extend the barrels, run every core gate**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test coverage -p core && node libs/core/scripts/check-purity.mjs
```

- [ ] **Step 6: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "feat(core): Invitation, with expiry derived rather than stored

InvitationStatus has no EXPIRED member on purpose: expiry is a fact that becomes
true while nothing is running, so storing it would make every read responsible
for repairing the row first. isOpenAt(now) answers both halves, and takes the
instant rather than reading a clock."
```

---

## Task 5: `IOrganizationService` and its conformance suite

The executable contract both apps implement. Read `libs/core/src/users/testing/runIUserServiceContract.ts` and `IUserServiceContractDeps.ts` in full before starting — this suite follows their shape exactly, including the discipline that every right-hand side comes from the world the host promised rather than from what the implementation just returned.

**Files:**
- Create: `template/libs/core/src/organizations/contracts/{IOrganizationService,index}.ts`
- Create: `template/libs/core/src/organizations/testing/{IOrganizationServiceContractDeps,organization-fixtures,runIOrganizationServiceContract,index}.ts`
- Modify: `template/libs/core/package.json` — two more subpaths
- Test: driven by Task 15 (backend) and Task 16 (webapp); core itself runs it against an in-memory reference implementation in `testing/__tests__/`

**Interfaces:**
- Consumes: everything from Tasks 3 and 4, `PaginatedResult` from `shared/types`, `ConformanceExpect` from `shared/testing`.
- Produces: `IOrganizationService` (the signatures below, verbatim) and `runIOrganizationServiceContract(deps)`.

```ts
export interface IOrganizationService {
  createOrganization(actorId: UserId, input: CreateOrganizationInput): Promise<Organization>;
  listOrganizations(actorId: UserId, query: OrganizationQuery): Promise<PaginatedResult<Organization>>;
  getOrganization(actorId: UserId, organizationId: OrganizationId): Promise<Organization>;
  updateOrganization(actorId: UserId, organizationId: OrganizationId, input: UpdateOrganizationInput): Promise<Organization>;
  deleteOrganization(actorId: UserId, organizationId: OrganizationId): Promise<void>;

  listMembers(actorId: UserId, organizationId: OrganizationId, query: MemberQuery): Promise<PaginatedResult<Membership>>;
  changeMemberRole(actorId: UserId, organizationId: OrganizationId, targetUserId: UserId, role: OrgRole): Promise<Membership>;
  removeMember(actorId: UserId, organizationId: OrganizationId, targetUserId: UserId): Promise<void>;

  inviteMember(actorId: UserId, organizationId: OrganizationId, input: InviteMemberInput): Promise<Invitation>;
  listInvitations(actorId: UserId, organizationId: OrganizationId, query: InvitationQuery): Promise<PaginatedResult<Invitation>>;
  revokeInvitation(actorId: UserId, organizationId: OrganizationId, invitationId: InvitationId): Promise<Invitation>;
  acceptInvitation(actorId: UserId, token: string): Promise<Membership>;
}
```

Every method takes `actorId` first and `organizationId` explicitly — ADR-0007, and the same rule `IUserService` follows for the actor. `acceptInvitation` takes a token rather than an id because the token is the only thing the recipient has; core models it as an opaque `string` and says nothing about its format, which is a backend concern (D14).

- [ ] **Step 1: Write the deps**

```ts
/** One isolated world, built fresh for each test. */
export interface OrganizationServiceContractContext {
  /** The implementation under test, holding exactly the world below. */
  service: IOrganizationService;
  /** The organization every assertion is about. `owner` is its ONLY owner. */
  organization: Organization;
  /** The sole OWNER — the subject of the last-owner invariant. */
  owner: User;
  /** An ADMIN of `organization`. */
  admin: User;
  /** An ordinary MEMBER of `organization`. */
  member: User;
  /** Somebody who belongs to no organization at all. */
  outsider: User;
  /**
   * An address that is nobody's account and nobody's open invitation.
   *
   * The suite cannot invent one: a host is free to seed whatever accounts it
   * likes, and an address this suite made up could collide with one of them —
   * which would fail the invitation assertions with `ALREADY_A_MEMBER` and blame
   * the implementation for the host's choice of fixtures.
   */
  uninvitedEmail: string;
  /**
   * The token a recipient would present for this invitation.
   *
   * The host knows how its own invitations are redeemed and the suite must not:
   * core models the token as an opaque string, and a suite that built one would
   * be asserting a format core has no business knowing (D14).
   */
  tokenFor: (invitation: Invitation) => Promise<string>;
  /**
   * The instant this world considers now.
   *
   * Every expiry assertion is relative to it. Without it the suite would have to
   * read a clock, and an assertion about expiry that reads a clock is one that
   * passes or fails depending on how long the test took.
   */
  now: Date;
}

export interface IOrganizationServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it returns. */
  makeContext: () => Promise<OrganizationServiceContractContext>;
  /** Well-formed for the host's store, present in no world it builds. */
  absentOrganizationId: OrganizationId;
  /** Likewise, for an invitation. */
  absentInvitationId: InvitationId;
  /** A token that is well-formed for the host and redeems nothing. */
  absentToken: string;
}
```

- [ ] **Step 2: Write the suite**

Fifteen assertions. Write each with the `expect.equal(actual, expected, message)` third argument populated — every adapter before Phase 2's rule silently dropped it, and a failure with no message is a failure nobody can place.

| # | `it(...)` | Fault it catches |
|---|---|---|
| 1 | creates an organization and returns a real entity | a service returning the raw wire shape — `expect.ok(org instanceof Organization, …)` |
| 2 | makes the creator its sole OWNER | the invariant spec §9.4 opens with; assert via `listMembers`, comparing `role` against `OrgRole.OWNER` and the total against 1 |
| 3 | lists only organizations the actor belongs to | assert `outsider`'s list is empty **and** `owner`'s contains `organization.id` — one direction alone passes for a service that returns nothing |
| 4 | rejects an organization id that does not exist | `OrganizationNotFoundError` |
| 5 | refuses an organization the actor does not belong to, indistinguishably | `outsider` calling `getOrganization` gets `OrganizationNotFoundError` — the same error as #4, on purpose |
| 6 | updates the name and the change is readable afterwards | a service that returns an updated entity without storing it |
| 7 | soft-deletes, and the organization stops being listed | |
| 8 | lists the seeded members | compare against the world's **three** members, not against a count the service reports. Corrected during execution: the world seeds four users but `outsider` belongs to no organization by construction |
| 9 | changes a member's role and the change is readable afterwards | |
| 10 | **refuses to demote the last owner** | `LastOwnerError` — D15 |
| 11 | **refuses to remove the last owner** | `LastOwnerError` — D15 |
| 12 | issues an invitation that is PENDING and carries the invited role | assert `role` against the role passed in, not against a default |
| 13 | refuses to invite somebody who is already a member | `AlreadyAMemberError` |
| 14 | accepts an invitation, creating a membership with the invited role | the role must come from the invitation, not from a default — a service that always creates MEMBER passes every other assertion here |
| 15 | refuses a token that has already been redeemed | `InvitationNoLongerOpenError` |
| 16 | `revokeInvitation` closes it AND its token stops redeeming | **added during execution** — the table omitted revoke while the contract declared it. A service that flips the status and leaves the token live passes the status half alone, so the assertion ties the state change to its consequence |
| 17 | `revokeInvitation` with an absent id | `InvitationNotFoundError` |
| 18 | `acceptInvitation` with a token that was never issued | `InvitationNotFoundError` — never-existed stays distinct from closed (ruling T4-b) |

Assertions 2, 10, 11 and 14 are the ones with a real chance of being written unfailable. Write them like this:

```ts
      // The role the membership ends up with must come from the INVITATION, not
      // from a default. A service that ignores the invited role and always
      // creates a MEMBER satisfies every other assertion in this suite: the
      // invitation is still PENDING-then-ACCEPTED, the membership still exists,
      // the member still appears in the list. So the invitation is issued with a
      // role that is NOT the one a defaulting implementation would pick.
      it('accepts an invitation, creating a membership with the role the invitation carried', async () => {
        const { service, organization, owner, outsider, uninvitedEmail, tokenFor } = await makeContext();
        const invitation = await service.inviteMember(owner.id, organization.id, {
          email: uninvitedEmail,
          role: OrgRole.ADMIN,
        });
        expect.equal(invitation.role, OrgRole.ADMIN, 'the world must issue the invitation it was asked for');

        const membership = await service.acceptInvitation(outsider.id, await tokenFor(invitation));
        expect.ok(membership instanceof Membership, 'acceptInvitation must return a real entity');
        expect.equal(
          membership.role,
          OrgRole.ADMIN,
          'the membership must carry the role the invitation carried, not a default',
        );
        expect.equal(membership.organizationId, organization.id, 'and must be in the inviting organization');
        expect.equal(membership.userId, outsider.id, 'and must belong to whoever redeemed it');
      });
```

```ts
      // The world promises `owner` is the ONLY owner, so this is the invariant and
      // not a coincidence of fixtures. The guard asserts that promise first: a
      // host that seeded a second owner would otherwise make this pass for the
      // wrong reason, and report a green suite for an implementation with no
      // last-owner rule at all.
      it('refuses to demote the last owner', async () => {
        const { service, organization, owner } = await makeContext();
        const members = await service.listMembers(owner.id, organization.id, { page: 1, limit: 100 });
        const owners = members.data.filter((m) => m.role === OrgRole.OWNER);
        expect.equal(owners.length, 1, 'the world must seed exactly one owner for this assertion to mean anything');

        await expect.rejects(
          () => service.changeMemberRole(owner.id, organization.id, owner.id, OrgRole.ADMIN),
          LastOwnerError,
        );
      });
```

**Tenant isolation is deliberately absent from this suite.** D9 — org A's member asking for org B's resource gets 404 and never data — is a property of the *server*, and the webapp's implementation could satisfy it here only by having its stub refuse. A stub refusing proves the stub refuses. Per DEC-1 it lives in the backend-only security suite, built in Task 15.

- [ ] **Step 3: Write the in-memory reference implementation and run the suite against it**

`template/libs/core/tests/organizations/testing/reference.spec.ts` builds a `Map`-backed `IOrganizationService` and drives the suite through vitest via the existing adapter. This is what makes the suite's own 100% coverage achievable and proves the suite is satisfiable at all before any app tries.

- [ ] **Step 4: Watch four assertions fail**

For each of #2, #10, #11 and #14, break the reference implementation in the one way the assertion exists to catch, run, record the failure, restore:

```bash
cd "$PROBE" && npx nx test core -- tests/organizations
```

- #2: create the organization without a membership → assertion 2 red.
- #10: drop the last-owner check from `changeMemberRole` → assertion 10 red.
- #11: drop it from `removeMember` → assertion 11 red.
- #14: hard-code `OrgRole.MEMBER` in `acceptInvitation` → assertion 14 red, **and nothing else**. Record that: it is the evidence the assertion is carrying its own weight.

- [ ] **Step 5: Run every core gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test coverage -p core && node libs/core/scripts/check-purity.mjs && cd /Users/sinisimattia/Progetti/forge && npm run sanitize
```

```bash
git add -A template/ && git commit -m "feat(core): IOrganizationService and its conformance suite

Fifteen assertions both implementations are driven through. Four of them were
watched failing against a deliberately broken reference implementation, because
the other eleven stay green for a service that ignores the invited role, and an
assertion nobody has watched fail is not a guard.

Tenant isolation is deliberately NOT here (DEC-1): it is a server property, and
the webapp could satisfy it only by having its stub refuse."
```

---

## Task 6: Authorization layer two — `Permission`, `ROLE_PERMISSIONS`, `can()`

The roadmap's instruction is exact: **extend `can()`, do not restructure it.** It evaluates layer one and the ownership half of layer three today. This task adds layer two between them and nothing else; layer three completes in Task 7. Read `libs/core/src/authorization/policies/can.ts` in full first — especially the paragraph explaining why layer two is absent rather than stubbed.

**Files:**
- Modify: `template/libs/core/src/authorization/types/Permission.ts`, `Principal.ts`
- Create: `template/libs/core/src/authorization/policies/ROLE_PERMISSIONS.ts`
- Modify: `template/libs/core/src/authorization/policies/can.ts`, both barrels
- Test: `template/libs/core/tests/authorization/policies/{can,ROLE_PERMISSIONS}.spec.ts`

**Interfaces:**
- Consumes: `OrgRole`, `OrganizationId` (Task 3).
- Produces:

```ts
export type Permission
  = 'platform:administer'
    | 'audit:read'
    | 'user:read'
    | 'organization:read'
    | 'organization:update'
    | 'organization:delete'
    | 'member:read'
    | 'member:invite'
    | 'member:update'
    | 'member:remove'
    | 'invitation:read'
    | 'invitation:revoke'
    | 'grant:read'
    | 'grant:create'
    | 'grant:revoke';

export interface PrincipalMembership {
  organizationId: OrganizationId;
  role: OrgRole;
}

export interface Principal {
  userId: UserId;
  platformRole: PlatformRole;
  /** Every organization this person belongs to, and their role in each. */
  memberships: readonly PrincipalMembership[];
  /** Grants that are live as of hydration — Task 7 adds this field. */
}

/** What a decision is about. Every field is optional because the layers ask different questions. */
export interface Resource {
  /** The tenant the record belongs to. Absent for a record outside every tenant. */
  organizationId?: OrganizationId;
  /** The person the record is about. Absent when it is about nobody in particular. */
  ownerId?: UserId;
}

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]>;
```

`OwnedResource` is **renamed** to `Resource` and gains `organizationId`. Every existing call site changes. **Corrected during execution: there are FOUR inline `Principal` literals in the backend, not one** — `auth/guards/platform-admin.guard.ts`, `audit/audit.service.ts`, and `users/users.service.ts` twice. All four take `memberships: []` with a comment saying why an empty array is correct rather than an oversight. Task 7 makes `grants` required and must update the same four, plus every `Principal` literal in this task's two spec files.

- [ ] **Step 1: Write the failing tests**

`ROLE_PERMISSIONS.spec.ts` — the map is data, so its test is about the map's shape rather than its contents:

```ts
// Every role has an entry. `Record<OrgRole, …>` already makes a missing one a
// compile error, so what this catches is different: a role added to the enum and
// given an empty array to satisfy the compiler. An empty array is the shape of
// "somebody made this compile", and OWNER having fewer permissions than MEMBER
// is the shape of a copy-paste.
it('gives every role an entry, and none of them an empty one', () => {
  for (const role of Object.values(OrgRole)) {
    expect(ROLE_PERMISSIONS[role], role).toBeDefined();
    expect(ROLE_PERMISSIONS[role].length, role).toBeGreaterThan(0);
  }
});

// The roles are ordered in the enum most to least powerful, and nothing reads
// that order — but this test does, once, as the statement that the map agrees
// with the names it uses. A VIEWER that can do more than a MEMBER is a typo no
// type can catch.
it('never gives a less powerful role a permission a more powerful one lacks', () => {
  const order = [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.VIEWER];
  for (let i = 1; i < order.length; i += 1) {
    const stronger = new Set(ROLE_PERMISSIONS[order[i - 1]]);
    for (const permission of ROLE_PERMISSIONS[order[i]]) {
      expect(stronger.has(permission), `${order[i]} has ${permission} and ${order[i - 1]} does not`).toBe(true);
    }
  }
});

// `platform:administer` is not an organization permission and no role may grant
// it. Layer one is the only route to it, which is the whole reason every pass
// through layer one is audit-logged.
it('gives no organization role platform administration', () => {
  for (const role of Object.values(OrgRole)) {
    expect(ROLE_PERMISSIONS[role].includes('platform:administer'), role).toBe(false);
  }
});
```

`can.spec.ts` gains a `describe('layer two — organization role')` block:

```ts
// The membership consulted is the one for the RESOURCE's organization, not the
// first one the principal happens to hold. A principal belonging to two
// organizations with different roles is the only shape that can tell those apart,
// so it is the shape this test uses.
it('reads the role from the membership for the resource\'s organization', () => {
  const principal: Principal = {
    userId: USER_A,
    platformRole: PlatformRole.PLATFORM_USER,
    memberships: [
      { organizationId: ORG_1, role: OrgRole.VIEWER },
      { organizationId: ORG_2, role: OrgRole.ADMIN },
    ],
  };
  expect(can(principal, 'organization:update', { organizationId: ORG_1 })).toBe(false);
  expect(can(principal, 'organization:update', { organizationId: ORG_2 })).toBe(true);
});

// A resource in an organization the principal does not belong to is refused,
// and this is the assertion tenant isolation rests on in core. The server-side
// half — that the refusal is indistinguishable from "no such thing" — is D9 and
// lives in the backend suite.
it('refuses a resource in an organization the principal does not belong to', () => {
  const principal: Principal = {
    userId: USER_A,
    platformRole: PlatformRole.PLATFORM_USER,
    memberships: [{ organizationId: ORG_1, role: OrgRole.OWNER }],
  };
  expect(can(principal, 'organization:read', { organizationId: ORG_2 })).toBe(false);
});

// An organization permission asked without naming an organization has no answer,
// so it is refused rather than treated as "any of mine" — the same judgement
// `user:read` already makes for a missing owner.
it('refuses an organization permission asked without a resource', () => {
  const principal: Principal = {
    userId: USER_A,
    platformRole: PlatformRole.PLATFORM_USER,
    memberships: [{ organizationId: ORG_1, role: OrgRole.OWNER }],
  };
  expect(can(principal, 'organization:update')).toBe(false);
});

// Layer one is unconditional and runs before layer two, so a platform
// administrator passes for an organization they have no membership in. That is
// spec §9.5's first layer and the reason every such pass is recorded.
it('lets a platform administrator through with no membership at all', () => {
  const principal: Principal = {
    userId: USER_A,
    platformRole: PlatformRole.PLATFORM_ADMIN,
    memberships: [],
  };
  expect(can(principal, 'organization:delete', { organizationId: ORG_2 })).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd "$PROBE" && npx nx test core -- tests/authorization
```

- [ ] **Step 3: Write `ROLE_PERMISSIONS`**

```ts
/**
 * What each organization role may do, as data.
 *
 * A map and not a comparison against role order, because a comparison silently
 * re-ranks every role the day a member is inserted in the middle of the enum.
 * `Record<OrgRole, …>` makes a missing role a compile error; the suite beside
 * this file catches the other half — a role given an empty array to make that
 * error go away.
 *
 * `platform:administer` appears in no entry. It is layer one's alone, which is
 * why every pass through layer one is audit-logged: it is the one kind of access
 * whose justification is not visible in the request.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  [OrgRole.OWNER]: [
    'organization:read', 'organization:update', 'organization:delete',
    'member:read', 'member:invite', 'member:update', 'member:remove',
    'invitation:read', 'invitation:revoke',
    'grant:read', 'grant:create', 'grant:revoke',
    'audit:read',
  ],
  [OrgRole.ADMIN]: [
    'organization:read', 'organization:update',
    'member:read', 'member:invite', 'member:update', 'member:remove',
    'invitation:read', 'invitation:revoke',
    'grant:read', 'grant:create', 'grant:revoke',
    'audit:read',
  ],
  [OrgRole.MEMBER]: ['organization:read', 'member:read'],
  [OrgRole.VIEWER]: ['organization:read'],
};
```

- [ ] **Step 4: Extend `can()`**

Insert layer two between layer one and the switch. Keep the switch — it is the exhaustiveness forcing function, and every new `Permission` member must appear in it:

```ts
  // Layer one. Unchanged, and still ahead of everything: it is not a rule about
  // any one permission, it is the statement that this principal operates the
  // deployment.
  if (principal.platformRole === PlatformRole.PLATFORM_ADMIN) return true;

  // Layer two — organization role (ADR-0006, spec §9.5).
  //
  // The membership consulted is the one for the RESOURCE's organization. Reading
  // "the principal's role" without saying which organization it is in would give
  // a person their strongest role everywhere they belong, which is a cross-tenant
  // escalation wearing the shape of a convenience.
  //
  // A resource with no `organizationId` skips this layer rather than failing it:
  // `user:read` is about a person, not a tenant, and the switch below is where it
  // is answered.
  if (resource?.organizationId !== undefined) {
    const membership = principal.memberships.find(
      (m) => m.organizationId === resource.organizationId,
    );
    // No membership means no organization-role answer at all — not a weaker one.
    // This is the core half of tenant isolation.
    if (membership === undefined) return false;
    if (ROLE_PERMISSIONS[membership.role].includes(permission)) return true;
  }

  switch (permission) {
    // … existing cases, plus one per new member …
  }
```

The organization permissions reaching the switch are the ones asked *without* a resource, or asked with one whose role did not grant them. Both are refusals, so they share a case group with a comment saying exactly that. `audit:read` moves out of the `platform:administer` group: it now has an organization-scoped answer above, and reaching the switch means the ask named no organization.

- [ ] **Step 5: Run the tests, then watch the exhaustiveness forcing function fire**

```bash
cd "$PROBE" && npx nx test core -- tests/authorization
```

Then add a sixteenth `Permission` member with no case and no `ROLE_PERMISSIONS` entry:

```bash
cd "$PROBE" && npx nx run-many -t typecheck -p core backend webapp
```

Expected: **`core` ❌ and `backend` ❌** on `assertNever` (TS2345), and **`webapp` ✅**. Corrected during execution: the webapp has no `can()` or `Permission` consumer at all until Task 17 adds `useCan`, verified by grep. This plan originally expected the webapp to fail here by conflating two different unions — Task 2 made the webapp's *`AuthenticationOutcome`* consumers exhaustive, which says nothing about `Permission`. A passing webapp is correct, not a regression. **Task 17 owes the webapp-side exhaustiveness for `Permission`.** Record all three. Revert.

- [ ] **Step 6: Update `PlatformAdminGuard` for the renamed type**

It constructs a principal inline. It now needs `memberships: []` and the type is `Resource`. Give the empty array a comment, because an empty collection passed to a function that reads it is exactly the shape of an oversight:

```ts
      // No memberships: this guard asks only layer one, which never reads them.
      // Hydrating them here would be a database read for an answer that cannot
      // depend on it. `PermissionsGuard` (Task 13) is what hydrates a full
      // principal, and it is the only thing that needs one.
      memberships: [],
```

- [ ] **Step 7: Run every gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test coverage -p core backend webapp && node libs/core/scripts/check-purity.mjs && cd /Users/sinisimattia/Progetti/forge && npm run sanitize
```

```bash
git add -A template/ && git commit -m "feat(core): can() gains layer two — organization role

ROLE_PERMISSIONS is a map and not a comparison against role order, because a
comparison re-ranks every role the day a member is inserted in the middle.

The membership consulted is the one for the RESOURCE's organization. Reading
'the principal's role' without saying which organization would give a person
their strongest role everywhere they belong — a cross-tenant escalation wearing
the shape of a convenience. No membership means no answer, not a weaker one."
```

---

## Task 7: Authorization layer three — `ResourceGrant`, `isGrantLive`, `IAuthorizationService`

Spec §9.5's third layer: the exceptions roles cannot express. Grants are additive only and never widen into another tenant.

**Files:**
- Create: `template/libs/core/src/authorization/types/{ResourceGrant,ResourceType,GrantId,ResourceGrantJSON,CreateGrantInput,GrantQuery}.ts`
- Create: `template/libs/core/src/authorization/policies/isGrantLive.ts`
- Create: `template/libs/core/src/authorization/contracts/{IAuthorizationService,index}.ts`
- Create: `template/libs/core/src/authorization/testing/{IAuthorizationServiceContractDeps,runIAuthorizationServiceContract,index}.ts`
- Create: `template/libs/core/src/authorization/errors/{GrantNotFoundError,CrossTenantGrantError,index}.ts`
- Modify: `Principal.ts`, `can.ts`, `package.json`

**Interfaces:**
- Consumes: Task 6's `Permission`, `Resource`, `Principal`; `OrganizationId`, `UserId`.
- Produces:

```ts
export type ResourceType = Brand<string, 'ResourceType'>;

export interface ResourceGrant {
  id: GrantId;
  subjectUserId: UserId;
  /** The tenant the grant is confined to. A grant always names one. */
  organizationId: OrganizationId;
  resourceType: ResourceType;
  resourceId: string;
  permission: Permission;
  grantedBy: UserId;
  createdAt: Date;
  expiresAt: Date | null;
}

export function isGrantLive(grant: ResourceGrant, now: Date): boolean;

export interface IAuthorizationService {
  listGrants(actorId: UserId, organizationId: OrganizationId, query: GrantQuery): Promise<PaginatedResult<ResourceGrant>>;
  createGrant(actorId: UserId, organizationId: OrganizationId, input: CreateGrantInput): Promise<ResourceGrant>;
  revokeGrant(actorId: UserId, organizationId: OrganizationId, grantId: GrantId): Promise<void>;
}
```

`Principal` gains `grants: readonly ResourceGrant[]`, and `Resource` gains `resourceType?: ResourceType; resourceId?: string`.

- [ ] **Step 1: Write the failing tests**

`isGrantLive.spec.ts`:

```ts
// The instant is a parameter. `can()` must stay pure — the same principal and
// resource returning the same answer is what makes it callable from both sides
// of the wire — so the clock lives here, where the caller supplies it, and the
// hydrator is what applies it. See design ruling R2.
it('is live while unexpired, and a null expiry never lapses', () => {
  expect(isGrantLive({ ...grant, expiresAt: null }, AT('2099-01-01'))).toBe(true);
  expect(isGrantLive({ ...grant, expiresAt: AT('2026-02-01') }, AT('2026-01-31'))).toBe(true);
  expect(isGrantLive({ ...grant, expiresAt: AT('2026-02-01') }, AT('2026-02-01'))).toBe(false);
});
```

`can.spec.ts` gains `describe('layer three — resource grant')`:

```ts
// A grant names one organization and one record. This is the assertion that
// stops it widening: the same grant, asked about the same record id in a
// DIFFERENT organization, must not answer true. Spec §9.5 states it as "grants
// never widen into another tenant", and without this assertion an implementation
// that matched on resourceId alone would pass every other test here.
it('never lets a grant reach into another tenant', () => {
  const grant = { ...GRANT, organizationId: ORG_1, resourceType: DOC, resourceId: 'r1', permission: 'organization:update' as const };
  const principal: Principal = {
    userId: USER_A, platformRole: PlatformRole.PLATFORM_USER,
    memberships: [{ organizationId: ORG_1, role: OrgRole.VIEWER }, { organizationId: ORG_2, role: OrgRole.VIEWER }],
    grants: [grant],
  };
  expect(can(principal, 'organization:update', { organizationId: ORG_1, resourceType: DOC, resourceId: 'r1' })).toBe(true);
  expect(can(principal, 'organization:update', { organizationId: ORG_2, resourceType: DOC, resourceId: 'r1' })).toBe(false);
});

// Additive only: a grant adds a permission, it never removes one the role gave.
it('does not take away what the role already allowed', () => { /* VIEWER + no grant still reads */ });

// The grant must match all three of type, id and permission. Three assertions,
// each varying exactly one, because an implementation matching on two of the
// three passes any test that varies none.
it('requires the type, the id and the permission all to match', () => { /* … */ });
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Write `isGrantLive` and extend `can()`**

Layer three runs after layer two's role check and before the switch:

```ts
  // Layer three — resource grant (ADR-0006, spec §9.5).
  //
  // Additive only: this can turn a `false` into a `true` and never the reverse,
  // which is why it runs after the role check rather than instead of it.
  //
  // **`expiresAt` is not read here, and that is deliberate.** Reading it needs a
  // clock, and a clock would make this function impure — the same principal and
  // resource would stop producing the same answer, which is exactly what lets the
  // server and the client both call it. `Principal.grants` is documented as "live
  // as of hydration" and `isGrantLive` is the rule the hydrator applies. Design
  // ruling R2, and the reason Task 15 asserts an expired grant is absent from a
  // hydrated principal rather than trusting this line.
  if (
    resource?.organizationId !== undefined
    && resource.resourceType !== undefined
    && resource.resourceId !== undefined
  ) {
    const granted = principal.grants.some(
      (g) => g.permission === permission
        // All four, and the organization is the one that stops a grant widening:
        // matching on the record id alone would let a grant in one tenant answer
        // for a record that happens to share an id in another.
        && g.organizationId === resource.organizationId
        && g.resourceType === resource.resourceType
        && g.resourceId === resource.resourceId,
    );
    if (granted) return true;
  }
```

- [ ] **Step 4: Write `IAuthorizationService` and its conformance suite**

Six assertions: a grant is created and readable; it carries the actor as `grantedBy`; listing is scoped to the organization; revoking removes it; revoking an absent grant rejects with `GrantNotFoundError`; creating a grant for a subject who is not a member of the organization rejects with `CrossTenantGrantError`. That last one is the contract-level statement of "never widen into another tenant".

- [ ] **Step 5: Watch three assertions fail**

Break the reference implementation three ways — drop `organizationId` from the grant match in `can()`; let `createGrant` accept a non-member subject; let `listGrants` ignore its `organizationId` — and record which test goes red for each. If dropping `organizationId` from the match turns nothing red, the cross-tenant test is not testing it and must be rewritten before this task completes.

- [ ] **Step 6: Run every gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test coverage -p core backend webapp && node libs/core/scripts/check-purity.mjs && cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "feat(core): can() gains layer three — resource grants

Grants are additive only and confined to one tenant: the match is on
organization, type, id and permission together, because matching on the record
id alone lets a grant in one tenant answer for a record sharing an id in another.

can() does not read expiresAt. That needs a clock, and a clock would make the
function impure — the same inputs must give the same answer, which is what lets
the server and the client both call it. isGrantLive is the rule, and the
hydrator is what applies it (design ruling R2)."
```

---

## Task 8: The audit surface tenancy finally gives a subject

Phase 2 shipped `AuditEntry.organizationId` nullable and **deliberately unpinned by any assertion**, because no world could hold two tenants. Phase 3 is that world. The roadmap's second finding is that `runIAuditServiceContract.ts:439-473` checks ten wire fields of which three are null-symmetric in the backend driver — measured: dropping `organizationId` from `AuditService.toEntity` leaves 499/499 green.

**Files:**
- Modify: `template/libs/core/src/audit/enums/AuditAction.ts` — nine new members
- Modify: `template/libs/core/src/audit/types/AuditQuery.ts`, `AuditEntryProps.ts`, `AuditEntryJSON.ts`, `RecordAuditEntryInput.ts` — `organizationId` becomes `OrganizationId | null`
- Modify: `template/libs/core/src/audit/testing/runIAuditServiceContract.ts` — the masked assertions
- Modify: `template/libs/core/src/audit/testing/IAuditServiceContractDeps.ts` — the world must seed a non-null organization

**Interfaces:**
- Consumes: `OrganizationId` (Task 3).
- Produces: `AuditAction` members `ORGANIZATION_CREATED`, `ORGANIZATION_UPDATED`, `ORGANIZATION_DELETED`, `MEMBER_INVITED`, `INVITATION_REVOKED`, `INVITATION_ACCEPTED`, `MEMBER_ROLE_CHANGED`, `MEMBER_REMOVED`, `GRANT_CREATED`, `GRANT_REVOKED`. Tasks 10–14 record them.

Task 1 is what lets `INVITATION_REVOKED` and `INVITATION_ACCEPTED` past the sanitize gate. If `npm run sanitize` fails here, Task 1 did not land.

- [ ] **Step 1: Measure the mask before touching it**

```bash
cd "$PROBE" && sed -i '' 's/organizationId: row.organizationId/organizationId: null/' apps/backend/src/audit/audit.service.ts && npx nx test backend; git checkout apps/backend/src/audit/audit.service.ts
```

Expected: the whole backend suite stays green. Record the count. This is the finding, reproduced, and it is what Step 5 must overturn.

- [ ] **Step 2: Add the nine action members and re-type `organizationId`**

`AuditAction` members are appended, never reordered — the enum's own TSDoc says a stored value that changes meaning makes every historical entry a lie. `AuditQuery.organizationId` becomes `OrganizationId | null | undefined` and its "semantics deliberately not pinned yet" paragraph is **replaced**, because it is now pinned:

```ts
  /**
   * Only entries recorded against this tenant.
   *
   * An omitted filter does not narrow. An explicit `null` narrows to the entries
   * that belong to no tenant — platform-level events like a sign-in, which
   * happens before any organization is in play. Those are different questions and
   * the suite now asserts both, which it could not do in Phase 2 because no world
   * it could build held a tenant to tell apart.
   */
```

- [ ] **Step 3: Make the world seed a tenant**

`IAuditServiceContractDeps` gains an `organizationId: OrganizationId` the world promises at least one entry carries, and its TSDoc says why the host cannot seed `null` for it — core's own driver already seeds non-nulls with a comment saying why, so follow that file.

- [ ] **Step 4: Unmask the three assertions**

At `runIAuditServiceContract.ts:439-473`, the wire-shape assertion compares ten fields where three are `null` on both sides. Seed them non-null and compare against the world's promise:

```ts
        // Three of these were null on both sides until tenancy existed, so three
        // of the ten comparisons were `null === null` — an assertion about
        // nothing. Measured in Phase 2: dropping `organizationId` from the
        // backend's mapper left the entire suite green. The world now promises a
        // non-null value for each, and asserts that promise before relying on it.
        expect.ok(seeded.organizationId !== null, 'the world must seed an entry with a tenant');
        expect.equal(json.organizationId, world.organizationId, 'the entry must carry the tenant it was recorded against');
```

Do the same for `clientAddress` and `clientLabel`.

- [ ] **Step 5: Re-run the measurement and watch it fail this time**

```bash
cd "$PROBE" && sed -i '' 's/organizationId: row.organizationId/organizationId: null/' apps/backend/src/audit/audit.service.ts && npx nx test backend; git checkout apps/backend/src/audit/audit.service.ts
```

Expected now: **red**, in the wire-shape test specifically. Record the test name and the count. Repeat for the two client columns; the roadmap records that dropping those currently fails a *different* test while the wire-shape test stays green, so the evidence wanted here is that the wire-shape test now fails too.

- [ ] **Step 6: Run every gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test coverage -p core backend webapp && node libs/core/scripts/check-purity.mjs && cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "feat(core): unmask the audit contract's three null-symmetric assertions

Phase 2 shipped organizationId deliberately unpinned because no world could hold
two tenants. Measured then and reproduced now: dropping organizationId from the
backend's mapper left the whole suite green — three of ten compared fields were
null === null.

Tenancy is the world that makes them checkable. Nine action members added for
the events Tasks 10-14 record; members are appended and never reordered."
```

---

## Task 9: Persistence — four tables, the `audit_entries` column change, the record classes

**Files:**
- Create: `template/apps/backend/src/db/migrations/1758000003000-OrganizationsAndAuthorization.ts`
- Create: `template/apps/backend/src/organizations/{organization,membership,invitation}-record.entity.ts`
- Create: `template/apps/backend/src/authorization/resource-grant-record.entity.ts`
- Create: `template/apps/backend/src/organizations/{to-organization,to-membership,to-invitation}.ts`, `template/apps/backend/src/authorization/to-grant.ts`
- Modify: `template/apps/backend/src/app.module.ts` — four more record classes
- Modify: `template/apps/backend/src/audit/audit-entry-record.entity.ts` — `organizationId` type
- Test: `template/apps/backend/src/db/__tests__/migration-sql.spec.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7's entities and branded ids.
- Produces: `OrganizationRecord`, `MembershipRecord`, `InvitationRecord`, `ResourceGrantRecord`, and `toOrganizationEntity`/`toMembershipEntity`/`toInvitationEntity`/`toGrantEntity`. Read `apps/backend/src/users/user-record.entity.ts` and `to-user.ts` first — they state the conventions every record class follows, and this task adds four that must follow them identically.

**Schema.** Every table is created *after* `AppRoleAndDefaultPrivileges1758000000000`, so the application role gets its privileges with no `GRANT` in this file.

```sql
CREATE TABLE organizations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT uq_organizations_slug UNIQUE (slug)
);

CREATE TABLE memberships (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_memberships_org_user UNIQUE (organization_id, user_id)
);

CREATE TABLE organization_invitations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email               text        NOT NULL,
  role                text        NOT NULL,
  status              text        NOT NULL,
  token_hash          text        NOT NULL,
  invited_by_user_id  uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz NULL,
  accepted_by_user_id uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT uq_organization_invitations_token_hash UNIQUE (token_hash)
);

CREATE TABLE resource_grants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subject_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  resource_type   text        NOT NULL,
  resource_id     text        NOT NULL,
  permission      text        NOT NULL,
  granted_by      uuid        NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NULL
);
CREATE INDEX ix_resource_grants_subject ON resource_grants (subject_user_id, organization_id);
CREATE INDEX ix_memberships_user ON memberships (user_id);
CREATE INDEX ix_organization_invitations_org ON organization_invitations (organization_id);
```

`uq_memberships_org_user` is the database's half of "a person is a member of an organization at most once" — the contract asserts it, and this makes a concurrent double-insert impossible rather than unlikely.

`token_hash` and never the token, exactly as `email_verification_tokens` already does. Carry that table's `COMMENT ON COLUMN` across.

**The `audit_entries` change, and the foreign key that must not be added:**

```sql
ALTER TABLE audit_entries
  ALTER COLUMN organization_id TYPE uuid USING organization_id::uuid;
```

```ts
    // `USING organization_id::uuid` is safe because nothing has ever written a
    // non-null value into this column: it shipped in Phase 2 as `text` only
    // because core had no OrganizationId to brand it with, and no code path
    // populated it. Verified before writing this migration with
    // `SELECT count(*) FROM audit_entries WHERE organization_id IS NOT NULL`.
    //
    // **No foreign key to `organizations`, and this is where the temptation
    // arrives.** A referential action runs with the TABLE OWNER's privileges, so
    // any foreign key hands the application a route into a table it holds no
    // UPDATE or DELETE on — ON DELETE CASCADE erases history, SET NULL rewrites
    // who did what, and RESTRICT makes deleting an organization impossible for as
    // long as any entry names it. All four were measured against Postgres 16 for
    // `actor_user_id` in Phase 2; the result is identical here because it is a
    // property of referential actions, not of that column. ADR-0009, and D13.
```

- [ ] **Step 1: Extend the migration SQL spec first**

`migration-sql.spec.ts` reads the migration source as text and asserts on extracted statements. It carries a "What these guards do not catch" header — read it, and add the two new guards under the same honesty:

```ts
  // The guarantee this protects is not a property of `audit_entries` alone: it
  // is a property of every foreign key anyone ever adds to it. So the assertion
  // is over the whole migration directory, not over one file, and it is written
  // as "no statement anywhere references audit_entries in a REFERENCES clause"
  // rather than as a check of the one migration that creates it.
  it('adds no foreign key to audit_entries, in any migration', () => {
    const offenders = allMigrationSources()
      .flatMap((src) => sqlStatements(src))
      .filter((sql) => /REFERENCES\s+audit_entries/i.test(sql));
    expect(offenders).toEqual([]);
  });

  it('creates the four Phase 3 tables with their uniqueness constraints', () => {
    const statements = sqlStatements(read('1758000003000-OrganizationsAndAuthorization.ts'));
    for (const constraint of ['uq_organizations_slug', 'uq_memberships_org_user', 'uq_organization_invitations_token_hash']) {
      expect(statementsMatching(new RegExp(constraint), statements).length, constraint).toBe(1);
    }
  });
```

`statementsMatching` takes **statements, never sources** — its first draft in Phase 2 took sources and passed vacuously. Check the signature before calling it.

- [ ] **Step 2: Run to verify the new guards fail**

```bash
cd "$PROBE" && npx nx test backend -- migration-sql
```

- [ ] **Step 3: Write the migration**

`up()` creates the four tables and alters the audit column; `down()` drops the four children-before-parents and reverses the alter with `TYPE text USING organization_id::text`. A `down()` that cannot restore the prior type is a `down()` nobody can run.

- [ ] **Step 4: Write the four record classes and four mappers**

Follow `user-record.entity.ts` exactly: explicit `@Entity('…')`, explicit column names, ids as plain `string`, instants as `Date`, enum columns typed as core's enum with the same "the database does not enforce it" reasoning. Each mapper builds a real entity so every invariant runs on every read — `to-user.ts` says why, and the same applies here.

`InvitationRecord.tokenHash` has **no** mapper field: `Invitation` has no token and no hash on it, which is what makes it structurally impossible for a serialized invitation to carry one. Say that in the record class's TSDoc.

- [ ] **Step 5: Register the four record classes in `app.module.ts`**

`__tests__/composition-root.spec.ts` reads the entity list off the decorator. Add the four to its table with the fault each one's absence causes.

- [ ] **Step 6: Run it against a real database**

```bash
cd "$PROBE" && docker compose -f compose.yaml up -d db && npm run migration:run -w apps/backend
```

Then verify the privilege position holds for the new tables, as the application role:

```bash
docker compose exec db psql -U "$APP_DB_ROLE" -c "SELECT tablename, has_table_privilege('organizations','INSERT') AS ins, has_table_privilege('audit_entries','UPDATE') AS upd, has_table_privilege('audit_entries','DELETE') AS del FROM pg_tables WHERE tablename='organizations';"
```

Expected: `ins` is `t` (default privileges reached the new tables), `upd` and `del` are `f` (the audit revoke still holds). Record the output. Check Docker headroom with `docker run --rm alpine df -h /` before starting and stop if below 3 GB.

- [ ] **Step 7: Run every gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test -p backend && cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "feat(backend): organizations, memberships, invitations and grants

audit_entries.organization_id becomes uuid — safe because nothing ever wrote a
non-null value into it, verified before the alter. It gains NO foreign key to
organizations, and the guard for that is over every migration rather than this
one: a referential action runs with the table owner's privileges, so any foreign
key hands the application a route into a table it has no UPDATE or DELETE on
(ADR-0009, D13)."
```

---

## Task 10: Organizations — service, controller, module

**Files:**
- Create: `template/apps/backend/src/organizations/organizations.{module,controller,service}.ts`
- Create: `template/apps/backend/src/organizations/dto/{create-organization,update-organization,organization-response,list-organizations.query}.dto.ts` + `index.ts`
- Modify: `template/apps/backend/src/app.module.ts`
- Test: `template/apps/backend/src/organizations/__tests__/organizations.controller.spec.ts`, `organizations.service.spec.ts`

**Interfaces:**
- Consumes: Task 9's records and mappers; `IOrganizationService` (Task 5); `AuditService`.
- Produces: `OrganizationsService implements IOrganizationService` (the organization half; Tasks 11 and 12 add members and invitations to the same class), and `OrganizationsModule` exporting it.

Endpoints, per spec §9.7: `POST /organizations`, `GET /organizations`, `GET /organizations/:id`, `PATCH /organizations/:id`, `DELETE /organizations/:id`.

- [ ] **Step 1: Write the failing controller and service tests**

The controller spec asserts route shape, DTO validation and that each handler delegates. The service spec asserts the behaviour the conformance suite cannot see from outside:

```ts
  // Creating an organization makes the creator its OWNER, in the same
  // transaction. Two statements that can half-succeed would leave an
  // organization with no owner at all — a state the last-owner invariant makes
  // unreachable by any other path, and therefore one nothing else would repair.
  it('creates the organization and the owner membership atomically', async () => { /* … */ });

  // Every one of these is audit-logged (spec §9.6), and the entry carries the
  // organization — which is the field Phase 2 shipped nullable and Task 8 made
  // assertable. An entry recorded with a null organization here is the exact
  // defect Task 8's measurement was about.
  it('records ORGANIZATION_CREATED against the organization it created', async () => { /* … */ });
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Write the service**

Use a transaction for create. Audit every mutation with the new `AuditAction` members from Task 8, each carrying `organizationId`.

**`listOrganizations` returns only the actor's own.** It is a join through `memberships` on `actorId`, never a scan of `organizations` — the difference is the whole of tenant isolation on this endpoint, and a scan passes every test that only checks the happy path. Task 20's D9 injection targets exactly this.

- [ ] **Step 4: Write the DTOs and the controller**

`forbidNonWhitelisted` is global, so every accepted field must be declared. Declare `ListOrganizationsQueryDto` rather than extending `PaginationQueryDto`, which is what `AuditQueryDto` and `ListUsersQueryDto` already do and for the reason `CLAUDE.md` gives: every field an endpoint accepts is visible in one place.

Nothing here is `@Public()`.

- [ ] **Step 5: Register the module and add its composition-root row**

- [ ] **Step 6: Run the gates and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test -p backend && cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "feat(backend): organization CRUD, with the owner membership created atomically

listOrganizations joins through memberships on the actor and never scans
organizations. That difference is the whole of tenant isolation on this
endpoint, and a scan passes every happy-path test."
```

---

## Task 11: Members — listing, role change, removal, and the last-owner invariant

**Files:**
- Create: `template/apps/backend/src/organizations/members.controller.ts`
- Create: `template/apps/backend/src/organizations/dto/{change-member-role,member-response,list-members.query}.dto.ts`
- Modify: `organizations.service.ts`, `organizations.module.ts`
- Test: `template/apps/backend/src/organizations/__tests__/members.controller.spec.ts`, and the service spec

**Interfaces:**
- Consumes: Task 10's service.
- Produces: `listMembers`, `changeMemberRole`, `removeMember` on `OrganizationsService`; `GET /organizations/:id/members`, `PATCH /organizations/:id/members/:userId`, `DELETE /organizations/:id/members/:userId`.

- [ ] **Step 1: Write the failing tests, including D15's server half**

```ts
  // D15. The invariant is "an organization always has at least one OWNER", so
  // the check is a COUNT of remaining owners and not an equality against the
  // actor's own id. Those differ in the case that matters: an ADMIN removing the
  // sole OWNER is not the owner leaving, and an implementation written as
  // `if (target === actor)` permits it while passing every test where the owner
  // acts on themselves.
  it('refuses to remove the last owner, whoever is asking', async () => {
    await expect(service.removeMember(admin.id, org.id, owner.id)).rejects.toThrow(LastOwnerError);
  });

  it('refuses to demote the last owner, whoever is asking', async () => {
    await expect(service.changeMemberRole(admin.id, org.id, owner.id, OrgRole.ADMIN)).rejects.toThrow(LastOwnerError);
  });

  // The other side of the same rule: with two owners, either may go.
  it('allows an owner to leave once another owner exists', async () => { /* … */ });
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement, with the owner count read inside the transaction**

The count and the write must be in one transaction at `SERIALIZABLE`, or two concurrent demotions each see two owners and both succeed, leaving zero. Say that in a comment, and say what it costs — a serialization failure the caller may retry.

- [ ] **Step 4: Watch the invariant fail**

Replace the count check with `if (targetUserId === actorId) throw new LastOwnerError()` — the plausible wrong implementation — and record which tests go red. Expected: the two "whoever is asking" tests. If only one does, the other is not testing what it claims.

- [ ] **Step 5: Run the gates and commit**

---

## Task 12: Invitations — issue, revoke, accept, and the mail

**Files:**
- Create: `template/apps/backend/src/organizations/invitations.controller.ts`
- Create: `template/apps/backend/src/organizations/dto/{invite-member,invitation-response,list-invitations.query}.dto.ts`
- Create: `template/apps/backend/src/mail/templates/organization-invitation.ts`
- Modify: `organizations.service.ts`, `organizations.module.ts`, `mail/templates/index.ts`
- Test: `template/apps/backend/src/organizations/__tests__/invitations.controller.spec.ts`

**Interfaces:**
- Consumes: `generateOpaqueToken`/`hashOpaqueToken` from `common/crypto`; `IMailer`; `PUBLIC_WEBAPP_URL`.
- Produces: `inviteMember`, `listInvitations`, `revokeInvitation`, `acceptInvitation`; `POST /organizations/:id/invitations`, `GET /organizations/:id/invitations`, `DELETE /organizations/:id/invitations/:invitationId`, `POST /invitations/:token/accept`.

`POST /invitations/:token/accept` is **not** `@Public()`. Spec §9.4: accepting while signed out routes through registration and then consumes the invitation — so the webapp sends an unauthenticated visitor to register first and returns them here with a session. The endpoint itself always has an actor, which is what makes `acceptedByUserId` truthful.

- [ ] **Step 1: Write the failing tests**

```ts
  // The token is generated and hashed exactly as every other single-use
  // credential in this backend is, and the row stores only the hash. The
  // assertion is that the stored value is NOT the token — recomputed
  // independently from `hashOpaqueToken`, not compared against whatever the
  // service stored, which would be a tautology.
  it('stores the digest of the token and never the token', async () => { /* … */ });

  // The address is checked at redemption. An invitation is an offer to ONE
  // address; letting anybody holding the link redeem it turns a leaked mail into
  // a membership. The suite's assertion is at the contract level; this one is
  // about the server's own refusal.
  it('refuses a token redeemed by an account with a different address', async () => { /* … */ });

  // Single-use, and the second attempt must not say WHICH of revoked, accepted
  // or expired it was — that distinguishes "this token was real once" from
  // "this token never existed".
  it('answers a revoked, accepted and expired token identically', async () => { /* … */ });
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

Look the invitation up **by token hash**, never by scanning and comparing — the same discipline `RefreshTokenService` follows. Accepting creates the membership and marks the invitation `ACCEPTED` in one transaction, and records `INVITATION_ACCEPTED` carrying the organization.

The mail template follows `mail/templates/verify-email.ts`: built from `PUBLIC_WEBAPP_URL`, carrying the token in a path segment and the organization's name in the body.

- [ ] **Step 4: Watch three faults fail**

Drop the address check; accept an already-ACCEPTED invitation; store the raw token. Record which test goes red for each. The third should also turn the "digest and never the token" assertion red — if it does not, that assertion is comparing the service's output against itself.

- [ ] **Step 5: Run the gates and commit**

```bash
cd /Users/sinisimattia/Progetti/forge && npm run sanitize
```

This is the first commit whose diff contains `invitations.controller.ts` and `INVITATION_ACCEPTED`. If the gate refuses it, Task 1 did not land — **do not weaken the gate here**; go back and finish Task 1 in its own commit.

---

## Task 13: `PrincipalService`, `PermissionsGuard`, `@RequirePermission`

**This is the riskiest task in the phase.** Read design ruling R3 before starting, and read `apps/backend/src/auth/guards/platform-admin.guard.ts` in full — it is the closest thing that already exists and it gets two things right that this task must also get right: the standing is read from the row and never from the presented credential, and the refusal carries no information.

**Files:**
- Create: `template/apps/backend/src/authorization/principal.service.ts`
- Create: `template/apps/backend/src/authorization/permissions.guard.ts`
- Create: `template/apps/backend/src/authorization/require-permission.decorator.ts`
- Create: `template/apps/backend/src/authorization/authorization.module.ts`
- Modify: every controller from Tasks 10–12 — each route gains `@UseGuards(PermissionsGuard)` and `@RequirePermission(...)`
- Test: `template/apps/backend/src/authorization/__tests__/{principal.service,permissions.guard}.spec.ts`

**Interfaces:**
- Consumes: `can`, `Principal`, `Permission`, `Resource`, `isGrantLive` (Tasks 6, 7); the record classes (Task 9).
- Produces:

```ts
@Injectable()
export class PrincipalService {
  /**
   * Hydrates the principal for `userId`, as of `now`.
   *
   * @param userId - the subject of the presented credential, and nothing else
   * @param now - the instant expiry is judged against
   */
  hydrate(userId: UserId, now: Date): Promise<Principal>;
}

export const RequirePermission: (permission: Permission) => MethodDecorator;
```

### The fault this task exists to avoid

`PermissionsGuard` must resolve the principal from **`request.user.userId`** — the subject of the credential — and must resolve the resource's `organizationId` from the **stored record**, not from the route parameter.

Hydrate from `:organizationId` and `can()` compares the request's organization against itself, always agrees, and D9 passes without testing anything. It is Phase 2's signature defect one level up: *a claim whose subject has no test is a claim about nothing*. Task 20 injects exactly this and must watch D9 go red.

- [ ] **Step 1: Write the failing `PrincipalService` tests**

```ts
  // R2. can() cannot read a clock, so the filtering happens here — which means
  // this is the only place the expiry rule is enforced at all, and an untested
  // hydrator would make `expiresAt` decorative across the whole system.
  it('excludes a grant that has expired as of the instant it was given', async () => {
    // seed one live grant and one expired
    const principal = await service.hydrate(user.id, AT('2026-06-01'));
    expect(principal.grants.map((g) => g.id)).toEqual([liveGrant.id]);
  });

  // A grant with a null expiry never lapses, and must not be filtered out by a
  // comparison that treats null as "in the past".
  it('keeps a grant with no expiry', async () => { /* … */ });

  // The memberships are every one the person holds, because can() chooses among
  // them by the resource's organization. A hydrator that returned only the
  // membership for "the current organization" would be re-introducing ambient
  // tenancy, which ADR-0007 exists to forbid.
  it('carries every membership the person holds', async () => { /* … */ });

  // The platform role comes from the row. The same reasoning PlatformAdminGuard
  // states: the credential is not re-issued when somebody's role changes, so a
  // role read from it would be whatever it was minted with.
  it('reads the platform role from the row, not from anything passed in', async () => { /* … */ });
```

- [ ] **Step 2: Write the failing `PermissionsGuard` tests**

```ts
  // R3, stated as a test. The guard is given a request whose route parameter
  // names ORG_B and whose credential's subject belongs only to ORG_A. If the
  // guard hydrated from the parameter it would find the membership it just
  // invented and allow the request.
  it('hydrates the principal from the credential\'s subject, not from the route', async () => {
    const request = requestFor({ user: { userId: memberOfA.id }, params: { id: ORG_B } });
    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(NotFoundException);
  });

  // The refusal is a 404 with the same body as "no such organization", for the
  // reason PlatformAdminGuard gives at length: a 403 confirms the resource
  // exists, which is free reconnaissance and, on a tenant-scoped route, an
  // enumeration oracle over other tenants' ids.
  it('refuses with the same answer as a missing organization', async () => { /* … */ });

  // A route carrying @RequirePermission but no resolvable organization is
  // refused rather than allowed. A guard that treats "I could not work out what
  // this is about" as "carry on" is a guard that opens every route whose
  // parameter name someone later changes.
  it('refuses when it cannot determine what the request is about', async () => { /* … */ });

  // A route with no @RequirePermission at all is not this guard's business — it
  // is still closed by the global JwtAuthGuard. Asserted so that adding the
  // guard globally later cannot silently deny every unannotated route.
  it('allows a route that declares no permission', async () => { /* … */ });
```

- [ ] **Step 3: Run to verify they fail**

- [ ] **Step 4: Implement `PrincipalService`**

```ts
  public async hydrate(userId: UserId, now: Date): Promise<Principal> {
    const row = await this.users.findOne({ where: { id: userId } });
    if (row === null) throw new NotFoundException();

    const memberships = await this.memberships.find({ where: { userId } });
    const grants = await this.grants.find({ where: { subjectUserId: userId } });

    return {
      userId: row.id as UserId,
      // From the row, never from the credential — `PlatformAdminGuard` states the
      // reasoning: the credential is not re-issued when a role changes.
      platformRole: row.platformRole,
      // Every membership, not the one for "the current organization". `can()`
      // chooses among them by the resource's organization, and narrowing here
      // would re-introduce the ambient tenancy ADR-0007 forbids.
      memberships: memberships.map((m) => ({
        organizationId: m.organizationId as OrganizationId,
        role: m.role,
      })),
      // R2: `can()` cannot read a clock, so this is the ONLY place the expiry
      // rule runs. An expired grant that survives this filter is honoured by
      // `can()` without complaint.
      grants: grants.map(toGrantEntity).filter((g) => isGrantLive(g, now)),
    };
  }
```

Nothing is cached. R4: a membership or grant revoked mid-session must be denied on the *next* request, which is D12, and any cache with a lifetime longer than a request makes D12 unsatisfiable.

- [ ] **Step 5: Implement the guard**

Resolve the resource from the stored record. The organization id a route names is a *claim*; the guard's job is to check it against what the actor actually holds, which it can only do by treating the actor's memberships as the authority:

```ts
    // The route parameter is what the request CLAIMS to be about. It is used to
    // look the record up and for nothing else — in particular it is never used to
    // build the principal. Hydrate from it and `can()` compares the request's
    // organization against itself, always agrees, and D9 passes without testing
    // anything. Design ruling R3.
    const principal = await this.principals.hydrate(actor.userId, new Date());
```

- [ ] **Step 6: Annotate every route from Tasks 10–12**

| Route | `@RequirePermission` |
|---|---|
| `GET /organizations/:id` | `organization:read` |
| `PATCH /organizations/:id` | `organization:update` |
| `DELETE /organizations/:id` | `organization:delete` |
| `GET /organizations/:id/members` | `member:read` |
| `PATCH /organizations/:id/members/:userId` | `member:update` |
| `DELETE /organizations/:id/members/:userId` | `member:remove` |
| `POST /organizations/:id/invitations` | `member:invite` |
| `GET /organizations/:id/invitations` | `invitation:read` |
| `DELETE /organizations/:id/invitations/:invitationId` | `invitation:revoke` |

`POST /organizations`, `GET /organizations` and `POST /invitations/:token/accept` carry none: the first two are not about an existing organization, and the third is authorized by holding the token.

- [ ] **Step 7: Watch the R3 fault fail**

Change the guard to hydrate from the route parameter:

```ts
const principal = await this.principals.hydrate(request.params.id as UserId, new Date());
```

```bash
cd "$PROBE" && npx nx test backend
```

Record exactly which tests go red. **At least the R3 test from Step 2 must.** If the suite stays green, this task is not done — the guard's most important property has no test, which is the defect this whole phase is organized around. Revert the injection.

- [ ] **Step 8: Add a wiring-deletion assertion**

Delete `@UseGuards(PermissionsGuard)` from `PATCH /organizations/:id` and run the backend suite. It must go red. Phase 2's measurement was that fifteen of sixteen wiring deletions left the suite green; this phase does not repeat that. Add the row to the composition-root spec's table with the fault it catches, then restore.

- [ ] **Step 9: Run every gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test -p backend && cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "feat(backend): PermissionsGuard, @RequirePermission and the principal hydrator

The principal is hydrated from the credential's subject and never from the route
parameter being judged. Hydrating from the parameter makes can() compare the
request's organization against itself: it always agrees, and tenant isolation
passes without testing anything. That fault was injected and watched turning the
guard's own test red before this landed (design ruling R3).

Nothing is cached: a grant revoked mid-session must be denied on the next
request (D12), and any cache outliving a request makes that unsatisfiable."
```

---

## Task 14: Grants, and the organization-scoped audit read

**Files:**
- Create: `template/apps/backend/src/authorization/{authorization.service,grants.controller}.ts`
- Create: `template/apps/backend/src/authorization/dto/{create-grant,grant-response,list-grants.query}.dto.ts`
- Create: `template/apps/backend/src/audit/organization-audit.controller.ts`
- Modify: `audit.service.ts` — an organization-scoped query path
- Test: `template/apps/backend/src/authorization/__tests__/grants.controller.spec.ts`, `template/apps/backend/src/audit/__tests__/organization-audit.controller.spec.ts`

**Interfaces:**
- Consumes: Task 13's guard; `IAuthorizationService` (Task 7).
- Produces: `GET/POST /organizations/:id/grants`, `DELETE /organizations/:id/grants/:grantId`, `GET /organizations/:id/audit`.

- [ ] **Step 1: Write the failing tests**

```ts
  // Spec §9.6: an org admin's audit view is scoped to their organization; a
  // PLATFORM_ADMIN may query across tenants. The scoping is applied by the
  // SERVICE from the route's organization after the guard has established the
  // actor belongs to it — not by the caller passing a filter, which a caller
  // could simply omit.
  it('scopes the page to the organization in the route, whatever the query says', async () => {
    const page = await controller.list(actor, ORG_A, { page: 1, limit: 50, organizationId: ORG_B });
    expect(page.data.every((e) => e.organizationId === ORG_A)).toBe(true);
  });

  // The cross-tenant read is PLATFORM_ADMIN's alone and stays on `GET /audit`,
  // which PlatformAdminGuard already closes. This asserts the two surfaces did
  // not merge: an org admin reaching GET /audit still gets the 404 that guard
  // gives.
  it('does not widen GET /audit to organization administrators', async () => { /* … */ });

  // A grant whose subject is not a member of the organization is refused. This
  // is "grants never widen into another tenant" at the write end — the read end
  // is can()'s organization match, and both are needed: either alone leaves a
  // path.
  it('refuses a grant for somebody who is not a member', async () => { /* … */ });
```

The first test is the one with a real chance of being written unfailable: pass `organizationId: ORG_B` in the query and assert the result is `ORG_A`'s. An implementation that merges the caller's filter into the query returns `ORG_B`'s entries — or none — and only a test that *supplies a conflicting filter* can tell.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

The organization-scoped audit read sets `organizationId` from the route **after** spreading the caller's query, so a caller-supplied value cannot survive. Write it in that order and comment why the order is load-bearing.

- [ ] **Step 4: Watch the scoping fail**

Spread the caller's query *after* the route's organization. Expected: the first test goes red and nothing else does. Record it.

- [ ] **Step 5: Run the gates and commit**

---

## Task 15: Backend conformance drivers and the tenant-isolation security suite

**Files:**
- Create: `template/apps/backend/src/organizations/__tests__/organizations.conformance.spec.ts`
- Create: `template/apps/backend/src/authorization/__tests__/authorization.conformance.spec.ts`
- Create: `template/libs/core/src/organizations/testing/runIOrganizationServiceSecurityContract.ts` + its deps
- Modify: `template/apps/backend/src/common/testing/identity-world.ts` — a tenancy world
- Test: the drivers are the tests

**Interfaces:**
- Consumes: Tasks 5, 7's suites; Tasks 10–14's implementation.
- Produces: the backend-only security suite carrying D9, and a `tenancy-world.ts` both conformance drivers build their context from.

### The backend-only suite (DEC-1)

Tenant isolation is a server property. These assertions go here and **not** in the shared suite, because the webapp could satisfy them only by having its stub refuse — and a stub refusing proves the stub refuses.

```ts
  // D9. The answer must be indistinguishable from "there is no such
  // organization" — same status, same body — for the reason PlatformAdminGuard
  // states: a 403 confirms the resource exists, and on a tenant-scoped route
  // that is an enumeration oracle over other tenants' ids.
  //
  // The assertion compares the two RESPONSES, not just the status. Comparing
  // statuses alone passes for an implementation that answers 404 with a body
  // saying "not a member of this organization", which leaks precisely the fact
  // the status was chosen to hide.
  it('answers a cross-tenant request exactly as it answers a missing one', async () => {
    const foreign = await request(app).get(`/organizations/${orgB.id}`).set(authFor(memberOfA));
    const missing = await request(app).get(`/organizations/${absentOrganizationId}`).set(authFor(memberOfA));
    expect.equal(foreign.status, missing.status, 'a foreign tenant and a missing one must share a status');
    expect.equal(JSON.stringify(foreign.body), JSON.stringify(missing.body), 'and a body');
  });

  it('never returns another tenant\'s members', async () => { /* … */ });
  it('never returns another tenant\'s invitations', async () => { /* … */ });
  it('never returns another tenant\'s audit entries', async () => { /* … */ });
  it('refuses to accept an invitation into an organization by editing the route', async () => { /* … */ });
```

- [ ] **Step 1: Build the tenancy world**

`identity-world.ts` already builds the identity fixtures. Add `tenancy-world.ts` beside it holding two organizations with disjoint members, so every cross-tenant assertion has a real other side. A world with one organization makes every D9 assertion vacuous.

- [ ] **Step 2: Write both conformance drivers**

They adapt jest to `ConformanceExpect` via the existing `adapt-jest.ts`. **Check that the adapter forwards the `message` third argument** — every adapter before Phase 2's rule silently dropped it.

- [ ] **Step 3: Assert the hydrator filters expired grants**

R2's cost-if-wrong. This is the assertion that makes `expiresAt` non-decorative:

```ts
  it('does not hydrate a grant that has expired', async () => { /* … */ });
```

- [ ] **Step 4: Run the whole backend suite**

```bash
cd "$PROBE" && npx nx test backend
```

Record the total. Phase 2 closed at 499.

- [ ] **Step 5: Watch D9 fail**

Make `getOrganization` skip the membership check. Expected: the cross-tenant assertions go red and the shared suite stays green — which is the evidence that DEC-1's split put the assertion where it can actually fail. Record both halves.

- [ ] **Step 6: Run the gates and commit**

---

## Task 16: Webapp services, fetchers and conformance adapters

**Files:**
- Create: `template/apps/webapp/app/services/{organization.service,authorization.service}.ts`
- Create: `template/apps/webapp/app/fetchers/{organization.fetchers,authorization.fetchers}.ts`
- Modify: `template/apps/webapp/app/services/index.ts`, `fetchers/index.ts`
- Modify: `template/apps/webapp/app/services/__tests__/stubBackend.ts`
- Test: `template/apps/webapp/app/services/__tests__/{organization,authorization}.service.conformance.spec.ts`

**Interfaces:**
- Consumes: Tasks 5, 7's contracts and suites.
- Produces: `OrganizationHttpService implements IOrganizationService`, `AuthorizationHttpService implements IAuthorizationService`.

Read `app/services/user.service.ts` first. Two responsibilities and no others: turn a response into the entity the contract promises, and turn a failure into the error the contract names. Follow its `domainErrorFor` shape — it maps the backend's `code` first and falls back to the status only for `404`, for the reason that file states at length.

- [ ] **Step 1: Write the conformance drivers**

They are the tests. Each builds its world through `stubBackend.ts` and drives the shared suite through the vitest adapter.

`tokenFor` is the dep that needs thought here: the stub backend knows its own invitation tokens, so it returns the one it minted. That is honest — the host knows how its invitations are redeemed, which is exactly what the dep's TSDoc says.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement both services**

**`Organization.fromJSON` and `Membership.fromJSON` on every path, never a cast.** A service handing back `json as unknown as Organization` satisfies every type in the file and fails the suite's `instanceof` checks, which is precisely why those checks are in it.

- [ ] **Step 4: Watch the reviver assertion fail**

Replace one `fromJSON` with a cast. Expected: the suite's `instanceof` assertion goes red. Record it, restore.

- [ ] **Step 5: Run the gates and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test -p webapp && cd /Users/sinisimattia/Progetti/forge && npm run sanitize
```

---

## Task 17: The organization store, `useCan`, and the `permission` middleware

**Files:**
- Create: `template/apps/webapp/app/stores/organization.ts`
- Create: `template/apps/webapp/app/composables/{useOrganization,useCan,useInvitations}.ts`
- Create: `template/apps/webapp/app/middleware/permission.ts`
- Test: `template/apps/webapp/app/{stores,composables,middleware}/__tests__/*.spec.ts`

**Interfaces:**
- Consumes: Task 16's services; `can` and `Principal` from core.
- Produces: `useOrganizationStore` holding the active organization and the actor's principal; `useCan(permission, resource?)` returning a `ComputedRef<boolean>`; `permission` route middleware.

- [ ] **Step 1: Write the failing tests**

```ts
  // ADR-0006's whole point: the webapp calls the SAME function, so a button is
  // hidden by exactly the rule that would have refused the request. The
  // assertion is that `useCan` delegates to core's `can` — not that it returns
  // the right answer for one case, which a re-implementation would also do.
  it('answers from core\'s can(), not from a rule of its own', () => { /* … */ });

  // A client-side `true` is never a permission. This test exists to make that
  // statement checkable: the store's principal is whatever the server sent, and
  // the middleware is a convenience that keeps somebody from reaching a page
  // they cannot use — not a control. Asserted by showing the server still
  // refuses when the middleware is bypassed, which lives in Task 20.
  it('is a convenience and not a control', () => { /* … */ });

  // Middleware is found by FILE NAME — nothing imports it — so renaming the file
  // silently unprotects every page that declared it. The test imports this exact
  // path, which is what `middleware/__tests__/auth.spec.ts` already does and for
  // the same reason.
  it('is reachable at the path pages name', async () => { /* … */ });
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

The store holds the actor's `Principal` — hydrated from an endpoint, never assembled client-side from guesses — plus the active organization. `useCan` is a thin `computed` over `can(principal, permission, resource)`.

The `permission` middleware awaits the store the way `middleware/auth.ts` does, and for the identical reason: on a full page load the principal is not there yet, and a guard that decided at that moment would refuse everybody.

**ADR-0006's rule is cited by no review dimension in any package** — the roadmap's fifth finding. Add the row now, to the webapp's and the backend's review dimension lists: *authorization decisions call core's `can()` and never restate a rule*.

- [ ] **Step 4: Watch the delegation fail**

Replace `useCan`'s body with a hard-coded `true`. Expected: the delegation test goes red. If only the "right answer" tests go red, the delegation test is not testing delegation.

- [ ] **Step 5: Run the gates and commit**

---

## Task 18: Pages, components, stories and locale strings

**Files:**
- Create: `template/apps/webapp/app/pages/organizations/{index,[slug]/settings,[slug]/members,[slug]/invitations,[slug]/audit}.vue`
- Create: `template/apps/webapp/app/pages/invitations/[token].vue`
- Create: `template/apps/webapp/app/components/organisms/{OrganizationSwitcher,MemberList,InvitationList,GrantList}.vue` + `.stories.ts` each
- Modify: `template/apps/webapp/i18n/locales/en.json`
- Test: one spec per component

**Interfaces:**
- Consumes: Task 17's composables and store.

- [ ] **Step 1: Check the layering rule before writing a component**

`scripts/check-atomic-layers.mjs` enforces atoms → molecules → organisms → templates → pages. An organism may compose molecules and atoms; **a molecule may not compose another molecule** — that rule was violated by a Phase 2 task brief and caught in review. Run the checker after each component rather than at the end.

- [ ] **Step 2: Write each component's failing spec, then the component**

Assertions use `.html()` rather than `.text()` where an attribute is the differentiator — Phase 2's D7 work found `.text()` blind to `title` and `aria-live`, and those are the likeliest accidental differentiators "because both look like kindnesses".

- [ ] **Step 3: Locale strings**

Every user-visible string goes in `en.json`. No literal prose in a template.

- [ ] **Step 4: Run every gate, including the layer checker and Storybook**

```bash
cd "$PROBE" && node apps/webapp/scripts/check-atomic-layers.mjs && npx nx run-many -t lint typecheck test -p webapp
```

Storybook's build failure is a known open issue (`[vite:build-html] Missing field 'moduleType'`), root cause unknown and dependency drift falsified. If it fails the same way, record it and move on — it is not this task's regression. **Neither a `0` exit nor the presence of `storybook-static/` is evidence here:** a zsh `command_not_found_handler` can return `EXIT=0` with no output directory, and a failed run still leaves the directory behind. Check for the built `index.html` and a recent mtime.

- [ ] **Step 5: Commit**

---

## Task 19: The access credential leaves the SSR payload

Ruled on 2026-09-20 and carried here deliberately: Phase 3 reopens the renewal path for tenancy anyway, so this lands beside work rather than on top of working code. `phase-2-decision-log.md` §6 has the mechanism, the cost, and the four things owed. **Read it before starting** — the first report on this claimed it was "one line in the store", and that estimate nearly decided it the other way.

**Files:**
- Modify: `template/apps/webapp/app/stores/auth.ts` — the seeded state
- Create: `template/apps/webapp/app/plugins/auth-init.client.ts`
- Modify: `template/apps/webapp/app/utils/authFetch.ts` — the `presented() === null` 401
- Modify: `template/apps/webapp/app/plugins/auth-init.server.ts` — its comment, which currently documents the exposure
- Test: `template/apps/webapp/app/{stores,plugins,utils}/__tests__/*.spec.ts`

- [ ] **Step 1: Reproduce the exposure**

Render a page for a signed-in visitor and grep the SSR payload for the credential. Record the finding — this is what Step 6 must overturn.

- [ ] **Step 2: Write the four failing tests**

```ts
  // The whole point. The credential must not be in the HTML.
  it('seeds status and the user but never the credential', () => { /* … */ });

  // The no-flash behaviour is NOT at risk and this test says so, because the
  // obvious worry is that removing the token reintroduces the flash. It does
  // not: the three-state `status` is what prevents it, not the token.
  it('still hydrates as authenticated without a signed-out frame', () => { /* … */ });

  // `createAuthFetch` today rethrows a 401 without renewing when nothing is
  // presented, ON PURPOSE — that is Phase 2 Task 16's fix for the bug that
  // signed a visitor out for a mistyped password. With no credential
  // client-side, the hydration 401 now takes that branch, so it needs a way to
  // tell "I have not renewed yet" from "my renewal was refused".
  it('renews on a hydration 401 and still does not renew on a refused sign-in', () => { /* … */ });

  // The second renewal race. SSR's Set-Cookie must land before the client
  // renews, or the client presents the rotated-away credential and reuse
  // detection revokes the whole family — signing out a visitor who did nothing
  // wrong.
  it('does not renew before the server-rendered rotation has landed', () => { /* … */ });
```

The third and fourth are the ones that make this task more than a deletion. Neither is optional.

- [ ] **Step 3: Run to verify all four fail**

- [ ] **Step 4: Implement all four pieces**

Delete the credential from the seeded state; add `auth-init.client.ts`; give `createAuthFetch` a way to distinguish a hydration 401 from a refused sign-in that does not reintroduce the sign-out bug; sequence the client renewal after the server's rotation.

- [ ] **Step 5: Watch the sign-out bug stay fixed**

Re-run Phase 2's own regression: a mistyped password must not sign out a signed-in visitor. This is the bug the `presented() === null` rethrow exists to prevent, and it is the thing most likely to be broken by this change. Record the result explicitly.

- [ ] **Step 6: Re-run Step 1's reproduction**

Expected: the credential is absent from the payload, and the page still hydrates authenticated with no flash.

- [ ] **Step 7: Run every gate and commit**

```bash
cd "$PROBE" && npx nx run-many -t lint typecheck test -p webapp && cd /Users/sinisimattia/Progetti/forge && npm run sanitize && git add -A template/ && git commit -m "fix(webapp): take the access credential out of the SSR payload

Ruled in Phase 2 and carried here because Phase 3 reopens the renewal path for
tenancy anyway. Four pieces, none of which is a deletion: seed status and the
user but not the credential; renew on hydration from a client plugin; handle the
presented() === null 401 that createAuthFetch deliberately rethrows without
renewing, because that rethrow is what stops a mistyped password signing a
visitor out; and sequence the client renewal after the server's rotation, or
reuse detection revokes the family.

The no-flash behaviour was never at risk: the three-state status prevents it,
not the token."
```

---

## Task 20: D9, D12, D15 — and watching each one fail

Spec §11's table. Three of the fifteen are Phase 3's, and the phase's bar is that each has been **observed to fail**.

**Files:**
- Create: `template/apps/backend/src/__tests__/discriminating/{d9-tenant-isolation,d12-grant-revocation,d15-last-owner}.spec.ts`
- Modify: `tests/integration/generated-project.test.mjs`

- [ ] **Step 1: D9 — org A member requests an org B resource**

Must answer 404/403 and never data, indistinguishably from a missing resource. Inject **the R3 fault** — hydrate the principal from the route parameter — and watch it go red. That is the injection this phase was designed around; record the full output.

- [ ] **Step 2: D12 — a `ResourceGrant` revoked mid-session**

The next request must be denied with no stale cache. Inject a per-session cache in `PrincipalService` and watch it go red. This is R4's cost-if-wrong made checkable.

- [ ] **Step 3: D15 — the last OWNER tries to leave or demote themselves**

Must be rejected. Inject the `targetUserId === actorId` implementation from Task 11 and watch it go red.

- [ ] **Step 4: Add the three to the generated-project gate**

The gate runs a generated project's own suites. Confirm the three run there and not only in `template/`.

- [ ] **Step 5: Close the CI gap the roadmap carried**

A direct push to `main` runs only the `unit` tier — `generated-project`, `storybook` and `docker` are all `if: pull_request`, so the gate this phase's tests live in does not run on the branch it protects. Fix `ci.yml`. The gate list also exists twice (root `affected` and `ci.yml`) with nothing pinning them together; add a test that compares the two lists.

- [ ] **Step 6: Run everything and commit**

```bash
cd /Users/sinisimattia/Progetti/forge && npm test && npm run sanitize
```

---

## Task 21: The Docker end-to-end tenancy walk

Spec §11: create an org → invite and accept → grant a permission → read the audit trail.

**Files:**
- Modify: `tests/integration/docker-e2e.test.mjs` (or the `FORGE_E2E=1` file as it is named)

- [ ] **Step 1: Check headroom first**

```bash
docker run --rm alpine df -h /
```

`docker system df` is **not** the headroom number. Stop if below 3 GB and reclaim your own build cache only — never touch a container you did not create. The user's `contents-backend-*` containers are live and unrelated.

- [ ] **Step 2: Extend the walk**

Register → verify → login → create an organization → invite a second account → accept → grant a permission → read `GET /organizations/:id/audit` and assert the entries for each step are present **with the organization on them**. That last assertion is the end-to-end form of Task 8's unmasking.

- [ ] **Step 3: Assert the cross-tenant refusal end to end**

Two organizations, disjoint members, one request across. The walk is the only place the whole stack — guard, hydrator, service, database — is exercised together, so D9 belongs here as well as in the unit tier.

- [ ] **Step 4: Run it**

```bash
cd /Users/sinisimattia/Progetti/forge && FORGE_E2E=1 node --test tests/integration/
```

- [ ] **Step 5: Sweep for orphans afterwards**

```bash
docker ps -a --filter "name=forge-" --format "{{.Names}}\t{{.Status}}"
```

A reviewer left a Postgres running seven hours in Phase 2. Remove only containers matching `forge-*`.

- [ ] **Step 6: Commit**

---

## Task 22: Fix wave, ADRs, decision log, roadmap

**Files:**
- Create: `template/docs/adrs/0010-organization-invitations.md`
- Modify: `template/docs/adrs/0008-ports-not-vendors.md` — the roadmap's fifth finding
- Modify: `template/libs/core/README.md` — the roadmap's sixth finding
- Modify: `template/apps/backend/CLAUDE.md`, `template/apps/webapp/CLAUDE.md`, `template/libs/core/CLAUDE.md`
- Create: `docs/superpowers/phase-3-decision-log.md`
- Modify: `docs/superpowers/phase-roadmap.md`

- [ ] **Step 1: Fix ADR-0008 or move the ports**

It says "every external capability is a port — an interface in core", and that is false: `IMailer` and `IPasswordHasher` live in the backend deliberately, and `IMailer.ts:21-27` argues against the ADR that governs it. Decide which is right and make them agree. They must not be left contradicting each other.

- [ ] **Step 2: Fix `libs/core/README.md`**

It claims one contract per domain and one suite per contract. Identities has two contracts, auth has two suites, `IBreachedPasswordRegistry` has none — and Phase 3 adds a third shape, a backend-only security suite with no shared partner. Its `shared/` inventory also omits `shared/policies`, which is load-bearing.

- [ ] **Step 3: Write ADR-0010**

Why invitations are single-use, expiring, hashed, address-checked at redemption, and why the three closed states answer identically.

- [ ] **Step 4: Update the three `CLAUDE.md` files**

The backend's "Present today" list, its module table, its ADR list (0010), and the `GLOBAL_PROVIDERS` description. The webapp's page and store inventory. Core's domain list.

- [ ] **Step 5: Write the decision log**

Same shape as Phase 2's: the five worth knowing, the formulations, the measurements, where the plan was wrong, my own claims corrected, the rulings, documented-not-fixed, out-of-phase, triage. **Record every design ruling R1–R5 and whether it survived contact.**

- [ ] **Step 6: Update the roadmap**

Mark Phase 3 built. Carry forward what Phase 4 must not get wrong. Note the two items this plan knowingly does not close: the template is still unverified on the Node it declares (`>=22 <23`; this machine has only v26), and Storybook's build failure is still un-root-caused.

- [ ] **Step 7: Final whole-branch review, then merge**

Dispatch the final reviewer on the most capable model. If it returns clean, use `superpowers:finishing-a-development-branch`.

---

## Self-review

**Spec coverage.** §9.4 organizations, memberships, `OrgRole`, invitations, the last-owner invariant → Tasks 3, 4, 5, 10, 11, 12. §9.5 three layers, `ROLE_PERMISSIONS`, `ResourceGrant`, `PermissionsGuard`, `@RequirePermission`, `useCan` → Tasks 6, 7, 13, 14, 17. §9.6 org-scoped audit → Tasks 8, 14. §9.7 every endpoint and every migration in the Phase 3 half → Tasks 9–14. §9.8 services, composables, stores, middleware, pages → Tasks 16–19. §11 D9, D12, D15 and the Docker walk → Tasks 20, 21.

**Not covered, deliberately:** nested teams (§9.9 defers them), OAuth (Phase 4), MFA (Phase 5). D10 and D11 belong to those phases.

**Type consistency.** `OrganizationId`/`MembershipId`/`InvitationId`/`GrantId` are branded in Task 3/4/7 and used unchanged after. `Resource` replaces `OwnedResource` in Task 6 and Task 6 updates its only shipped call site. `Principal` gains `memberships` in Task 6 and `grants` in Task 7, so every Task 6 test constructing a principal needs a `grants: []` added by Task 7 — **Task 7 Step 3 must update Task 6's tests**, which is called out there.

**One gap this plan knows about:** Task 5's suite has fifteen assertions and Task 15 drives it from the backend while Task 16 drives it from the webapp. If the webapp's stub cannot honestly satisfy an assertion, the rule is DEC-1 — move it to the backend-only suite, do not make the stub lie.
