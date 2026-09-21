# Forge Phase 4 — OAuth and Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generated project can sign in with Google, GitHub or any OIDC provider, link and unlink those identities from an existing account, and *cannot* be taken over by a provider that merely asserts somebody else's email address.

**Architecture:** One `IOAuthProvider` port in the backend with four adapters behind it (Google, GitHub, generic OIDC, and a development adapter that needs no third-party account), each self-registering only when its environment variables are present. The authorization-code + PKCE exchange is ordinary `fetch` against the provider's token and userinfo endpoints — no new dependency, no ID-token signature verification, because the token arrives from the issuer over TLS rather than through the browser. The *decision* the callback makes is a pure function in `libs/core`, exhaustively switched, so the rule that an email match does not establish identity is stated once and cannot be restated differently in an adapter.

**Tech Stack:** NestJS 11 (CommonJS, jest), Nuxt 4 (vitest), TypeORM 0.3 + Postgres 16, Node 22. No new runtime dependency in either app.

**Spec:** `docs/superpowers/specs/2026-09-17-forge-template-design.md` — §9.1 (ADR-0005, ADR-0008), §9.2, §9.3 ("Providers", "Account linking"), §9.7 (the endpoint surface), §11 (D11, D14).

**Prior phases:** `docs/superpowers/phase-roadmap.md` — read **"What Phase 4 must not get wrong"** and **"What Phase 4 inherits, already built"** before Task 1. The three decision logs (`phase-1-`, `phase-2-`, `phase-3-decision-log.md`) hold the evidence behind every constraint below; Phase 3's opening five are the ones that bind this phase.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec, `CLAUDE.md` and the roadmap.

**The three rules from `CLAUDE.md`:**

1. **`~/Progetti/Voku` is read-only. Always.** Never write to it; never run a command there that could change tracked or untracked state. Before and after any task, confirm `git -C ~/Progetti/Voku status --porcelain` is empty and `git -C ~/Progetti/Voku rev-parse HEAD` is still `fdfdbdeae2891954dd1cac538a082d5837f281dd`. Those two read-only commands are expected and required; only mutating commands are forbidden.
2. **The generator takes no dependencies.** `tools/create/` and `tests/` use Node builtins only, tested with `node --test`. Forge's root `package.json` has no `dependencies` and no `devDependencies`. This binds Tasks 1 and 2, which touch `tools/`.
3. **`npm run sanitize` must pass before any commit that touches `template/`.** Run it; do not weaken a rule to make a commit pass.

**Phase 4's own additions to the no-dependency posture:** neither `apps/backend/package.json` nor `apps/webapp/package.json` gains a runtime dependency in this phase. OAuth is `fetch` (global on Node 22) and `node:crypto`. If a task believes it needs `jose`, `openid-client`, `passport-google-oauth20` or similar, that is a signal the design was misread — see R2 below — and it is a **ruling to escalate**, not to make silently. Task 1 is the one exception and only for a *dev* dependency: if the Storybook root cause is an upstream version incompatibility, the fix may be a version change in `apps/webapp/package.json` plus a lockfile refresh.

**Security and structural rules carried from earlier phases, all still binding:**

- **Never add a foreign key to `audit_entries`.** A referential action runs with the table owner's privileges, which hands the application a route into a table it holds no `UPDATE` or `DELETE` on, voiding D13. `ALTER TABLE audit_entries OWNER TO <app role>` voids it the same way. See `template/docs/adrs/0009-two-database-roles.md`.
- **`libs/core` stays framework-agnostic and transport-free**, in prose as well as in imports. D14 is `grep -riE "\bjwt\b|cookie|http" libs/core/src` returning zero hits, and `libs/core/scripts/check-purity.mjs` plus the `purity` lint target enforce the import half. **This is why core's new vocabulary in Task 3 is "federated", not "OAuth"** — see R6.
- **Extend `can()`, do not restructure it.** Phase 4 adds no `Permission` member and no authorization layer. If a task finds itself editing `libs/core/src/authorization/`, stop: that is out of scope.
- **`can()`'s layer three still fires on no route, and D12 remains a labelled partial with a tripwire.** Phase 4 must not trip it — no new `can()` call site passes a `resourceType`/`resourceId`.
- **Nothing in the webapp enumerates `Permission`.** Unchanged by this phase; do not introduce a hardcoded permission list in a page, a menu or route meta.
- **Split any new conformance assertion by who can honestly satisfy it (DEC-1).** An assertion only the implementation that owns the store can satisfy belongs in a backend-only security suite, never in the shared suite the webapp stub also runs. Phase 4's federated-sign-in decisions are decided *by the server*; the webapp stub must not be made to lie to satisfy one.
- **`FakeDataSource` enforces no unique constraints and has no foreign keys.** Every uniqueness invariant and every `ON DELETE` path is invisible to the fast tier. A defect that needs a real constraint to appear will appear in the real-database tier or nowhere — say so in the test's own comment rather than implying coverage that is not there.
- **Any wiring this phase adds owes an assertion that fails when it is deleted**, plus the evidence of having watched it fail. Report the measurement (how many tests were green before the injection, how many red after) in the task report.
- **A green fast tier says nothing about whether the application boots.** A guard is instantiated in the module context of the controller that names it, so a module hosting a guarded controller must register every repository that guard injects. `apps/backend/src/__tests__/guard-wiring.spec.ts` catches that class in ~1.3 s and **discovers** guards from `@UseGuards` metadata. **Add guards to controllers and let discovery find them — do not convert that spec back into a list.**
- **Do not enumerate the bad inputs; refuse what you do not model.** Five fix rounds of per-spelling patching in `migration-sql.spec.ts` each closed one variant and each was followed by another. Where a guard is needed, write a fail-closed whitelist. This binds Task 9 (a new migration) and Task 5 (provider identifiers arriving in a route parameter).
- **A guard's failure message is part of its design.** If a refusal has an obvious remedy that is catastrophic, the message must give the author a way to get unstuck without reaching for it.
- **Check whether a fault is fail-closed before writing a test against it.** Show a fault is fail-closed by measuring it. This binds Task 13 (D11) directly.
- **Prose is part of the artifact and no gate reads it.** Phase 3 shipped five false comments. When a comment is found to be false, prefer making it **true** — add the assertion it claims exists — over softening the sentence.
- **The artifact that ships is the thing under test.** A spec that assembles its own module, or a probe that registers the provider it is checking for, is testing itself. Where wiring is a value, assert that exact value; where it is imperative, extract it into a function that the entry point and the spec both call.
- **A check that cannot fail is worse than an absent one**, because it reads as evidence.

**How to run a gate (read this before writing any command):**

**No gate can run inside `template/`.** Its `package.json` is `"name": "__FORGE_NAME__"` with unresolved tokens throughout — `npm`, `nx` and `tsc` all fail there for reasons that have nothing to do with the change under test. Every backend/webapp/core gate runs against a **generated probe project**:

```bash
PROBE_ROOT=$(mktemp -d)
PROBE="$PROBE_ROOT/probe"
cd /Users/sinisimattia/Progetti/forge
npm run create -- --name probe --out "$PROBE_ROOT" --yes --no-git
cd "$PROBE" && npm ci
# ...then the gate, e.g.:
npx nx run backend:test
npx nx run-many -t lint typecheck test build purity layers
# cleanup — the directory you created, named directly:
rm -rf "$PROBE_ROOT"
```

**The cleanup form is not negotiable.** Remove `$PROBE_ROOT` — the directory `mktemp -d` created, named directly. Never a path derived from another by taking its parent, and never `$TMPDIR`. A subagent following an ambiguous earlier wording deleted the whole of `$TMPDIR` (Phase 3, incident I1).

Forge's own gates *do* run at the repository root and are the fast ones:

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize      # the extraction gate — mandatory before any commit touching template/
npm test              # the generator's unit tests (node --test)
npm run test:integration   # generates a project and runs its gates; FORGE_E2E=1 adds Docker
```

**Core test conventions (verified — do not deviate):**

- Core's jest `testMatch` is `['<rootDir>/tests/**/*.spec.ts']`. **A spec placed under `libs/core/src/**/__tests__/` never runs and passes by never running.** Every core test goes in `libs/core/tests/<domain>/<folder>/<Name>.spec.ts`, mirroring the source path.
- Core runs under **jest**, not vitest. `npx nx run core:test`. A `vitest` command against core is wrong.
- Core holds 100% coverage thresholds and `npx nx run core:coverage` runs in CI. A new pure function with an unreachable branch fails it.
- Entities and policies are one symbol per file, re-exported through the folder's `index.ts`, consumed via the per-domain subpath `__FORGE_SCOPE__/core/<domain>/<folder>`.

**Docker, when a task needs it:** headroom is checked with `docker run --rm alpine df -h /` — **never** `docker system df`, which reports the wrong thing. The floor is 3 GB. **This machine runs unrelated live containers, including a Postgres on 5432. Never stop, remove or reconfigure a container you did not create.** Build cache and dangling images are fair game.

**Node on this machine:** every `node@20`…`node@26` opt-symlink aliases one Node 26.5.0 keg, so there is no real Node 22 here. The template declares `>=22 <23` and CI pins 22. An ad hoc local run is on 26 and the version-mismatch warning firing is the guard working, not a fault to silence.

---

## The design rulings this plan implements

Made on 2026-09-21, before Task 1, from spec §9.3 and ADR-0008's amended "where a port lives" clause. Each is binding on the tasks below; an implementer who finds one wrong reports the contradiction rather than working around it.

**R1 — `IOAuthProvider` lives in the backend, not in `libs/core`.** ADR-0008's test is *whose question is it?* Authorization URLs, authorization codes, redirect URIs, token endpoints and bearer tokens are transport, and core's purity rule forbids that vocabulary in prose as well as in imports. The port goes in `apps/backend/src/auth/oauth/`, beside its adapters and its DI token — the same shape `IMailer` and `IPasswordHasher` already have. *Cost if wrong:* the port would have to move, and core's `purity` gate plus D14 would have caught it first.

**R2 — Authorization code + PKCE, then userinfo. No ID-token verification, no new dependency.** The access token is obtained by this server directly from the provider's token endpoint over TLS; it did not travel through the browser. Reading the account from the provider's userinfo endpoint with that token is therefore sound, and it removes JWKS fetching, key rotation, caching and algorithm-confusion from the surface entirely. *Cost if wrong:* a deployment that needs ID-token claims not exposed by userinfo has to widen the port — which is ADR-0008's own documented negative, not a surprise.

**R3 — The authorization request is a database row, not a cookie.** `oauth_authorization_requests` holds a hashed state value, the PKCE verifier, the provider, the purpose, an optional `user_id`, `expires_at` and `consumed_at`. Single-use, with reuse visible — the pattern `email_verification_tokens`, `password_reset_tokens` and `refresh_tokens` already use — and the only form that works with more than one backend instance behind a load balancer. *Cost if wrong:* a signed cookie would be less state at the cost of a revocation story this repo does not have.

**R4 — Two start endpoints, one callback, and the purpose is stored rather than sent.** `GET /auth/oauth/:provider` is `@Public()` and redirects — that is sign-in. `POST /users/me/identities/:provider` (already in spec §9.7) is authenticated and returns `{ authorizationUrl }` as JSON for the client to navigate to — that is linking. **This is why that endpoint exists in the spec:** a top-level browser navigation cannot carry the in-memory access credential, so the link flow has to be started by an authenticated `fetch`. The callback reads `purpose` off the stored row, so a link can never be downgraded to a sign-in by editing a URL, and a sign-in can never be upgraded to a link.

**R5 — The callback puts no credential in a URL.** It sets the refresh cookie exactly as `POST /auth/login` does and redirects to the webapp, which obtains its access credential through the renewal path Phase 3 built (`app/plugins/auth-init.client.ts` → `POST /auth/refresh`). A token in a query string lands in browser history, in the `Referer` header and in every log between here and there. Failures redirect with an opaque `?error=<code>` this repository owns — **never a provider's error string**, which is attacker-influenced text rendered in our own UI.

**R6 — The decision is a pure function in core; the backend does the I/O, and core says "federated", not "OAuth".** `decideFederatedSignIn()` returns a discriminated union that every consumer switches on exhaustively, ending in `assertNever`. "OAuth" names a protocol — a transport — and core may not name one; "a federated provider asserted this account" is the same fact stated in the domain's own vocabulary. The boundary between the two names is exactly the boundary between core and the backend, which is the point. *Cost if wrong:* two names for one concept, which the ADR and the decision log both pin.

**R7 — An unverified provider email matches nothing and provisions nothing.** GitHub will hand you an unverified address if you ask carelessly. Treating a provider's unverified assertion as identity is D11's takeover path wearing a different hat, so it is refused before any matching happens.

**R8 — A federated sign-in is subject to the same account-state rules as a password sign-in.** Deleted, suspended and unverified accounts are refused in the order `AuthenticationRejectionReason` fixes, and the refusal is recorded and never returned. An account an administrator suspended must not be reachable through Google.

**R9 — No auto-link, and the remedy is the authenticated link flow.** Spec §9.3 permits "either an authenticated session or a verified-email challenge"; this phase ships the authenticated-session route only, and records the challenge as deliberately deferred. A callback whose provider-verified email matches an existing account is refused with `?error=EMAIL_ALREADY_REGISTERED`, and the webapp tells the person to sign in with their existing method and link the provider from account settings. **This refusal is D11.**

**R10 — The development adapter ships, and refuses to exist in production.** ADR-0008 requires a development adapter behind every port, and a generated project must be able to exercise the whole OAuth flow on first clone with no developer application registered anywhere. The adapter registers only when `OAUTH_DEV_ENABLED` is set **and** `NODE_ENV !== 'production'`; when it is configured in production the application **refuses to start**, loudly, rather than quietly declining to register. A silent decline is the failure mode where somebody's staging config reaches production and nobody finds out which half of the condition saved them.

**R11 — Identities keep showing `providerAccountId`, and no label column is added.** The UI already renders the subject (`IdentityList.vue`'s Account column, with `117392044118` in its own fixtures). A provider-asserted display label is a real improvement and a real column, in core's entity, its wire shape, its conformance suite and a migration — out of scope here, and recorded in the decision log as considered and deferred.

**R13 — `GET /auth/oauth/providers` is a third endpoint, and spec §9.7's table does not list it.** Stated plainly rather than slipped in: §9.3 requires that "an unconfigured provider is absent from the login page", and a client cannot honour that without being told which providers exist. The alternatives were a Nuxt public runtime variable listing them — configuration stated twice, in two files, free to drift, with the drift invisible until somebody presses a button that fails — or nothing, which fails §9.3. The endpoint is `@Public()` and discloses only which providers this deployment configured, which is already visible to anyone who loads the login page. *Cost if wrong:* one route to delete.

**R14 — `oauth_authorization_requests` is a table spec §9.7's migration list does not name.** Same treatment for the same reason: the list enumerates the tables the spec's authors foresaw, and PKCE plus single-use state needs somewhere to live (R3). It is additive, touches nothing existing, and is dropped by its own `down()`. Both R13 and R14 are additions the spec's *requirements* imply and its *enumerations* omit — not scope the spec excluded.

**R12 — The two chores come first, in their own commits.** The Storybook gate before any task adds a fifth story file, and the `tools/sanitize.mjs` compound-word rule before any task adds template prose. This is the Phase 3 Task 1 precedent: a gate change never rides inside a feature task, because a feature task's diff is where a weakened gate hides.

---

## File structure

**Created:**

| Path | Responsibility |
|---|---|
| `template/libs/core/src/identities/types/FederatedAccount.ts` | what a federated provider asserted, in domain vocabulary |
| `template/libs/core/src/identities/types/FederatedSignInDecision.ts` | the discriminated union `decideFederatedSignIn` returns |
| `template/libs/core/src/identities/types/FederatedSignInInput.ts` | the facts the decision is made from |
| `template/libs/core/src/identities/policies/decideFederatedSignIn.ts` | **the rule** — one pure function, no clock, no I/O |
| `template/libs/core/src/identities/enums/FederatedSignInOutcome.ts` | the four endings, as an enum with string values |
| `template/libs/core/src/identities/types/FederatedLink*.ts` | the link decision's input, union and outcome enum |
| `template/libs/core/tests/identities/policies/decideFederatedSignIn.spec.ts` | its suite, including the D11 case at unit level |
| `template/libs/core/tests/identities/policies/decideFederatedLink.spec.ts` | the link rule's suite |
| `template/apps/backend/src/auth/oauth/IOAuthProvider.ts` | the port, plus its DI token |
| `template/apps/backend/src/auth/oauth/oauth-provider.registry.ts` | which providers this deployment has, built from configuration |
| `template/apps/backend/src/auth/oauth/adapters/DevOAuthProvider.ts` | the development adapter (R10) |
| `template/apps/backend/src/auth/oauth/adapters/GoogleOAuthProvider.ts` | Google |
| `template/apps/backend/src/auth/oauth/adapters/OidcOAuthProvider.ts` | any OIDC issuer, by discovery |
| `template/apps/backend/src/auth/oauth/adapters/GitHubOAuthProvider.ts` | GitHub (not OIDC; two API calls) |
| `template/apps/backend/src/auth/oauth/oauth.service.ts` | begin, beginLink, complete — the flow |
| `template/apps/backend/src/auth/oauth/oauth.controller.ts` | the three public routes |
| `template/apps/backend/src/auth/oauth/oauth-authorization-request.entity.ts` | the row R3 describes |
| `template/apps/backend/src/auth/oauth/pkce.ts` | verifier/challenge generation, `node:crypto` only |
| `template/apps/backend/src/db/migrations/1758000004000-OAuthAuthorizationRequests.ts` | its table |
| `template/apps/backend/src/__tests__/discriminating/d11-federated-email-match.spec.ts` | **D11** |
| `template/apps/webapp/app/fetchers/oauth.fetchers.ts` | the three request shapes |
| `template/apps/webapp/app/services/oauth.service.ts` | the client half |
| `template/apps/webapp/app/composables/useOAuthProviders.ts` | which buttons to render |
| `template/apps/webapp/app/components/organisms/OAuthButtons.vue` | the buttons |
| `template/apps/webapp/stories/organisms/OAuthButtons.stories.ts` | its story (Task 1 must be done first) |
| `template/apps/webapp/app/pages/oauth/callback.vue` | where the provider sends the browser back |
| `template/docs/adrs/0011-federated-identity-never-auto-links.md` | the ADR |

**Modified:** `template/libs/core/src/audit/enums/AuditAction.ts`, `template/libs/core/src/identities/{types,errors,policies}/index.ts`, `template/apps/backend/src/app.module.ts`, `template/apps/backend/src/auth/auth.module.ts`, `template/apps/backend/src/identities/identities.controller.ts`, `template/apps/backend/src/common/filters/http-exception.filter.ts`, `template/apps/backend/src/db/__tests__/migration-sql.spec.ts`, `template/apps/backend/src/__tests__/composition-root.spec.ts`, `template/apps/webapp/app/components/organisms/{IdentityList,LoginForm}.vue`, `template/apps/webapp/app/composables/useIdentities.ts`, `template/apps/webapp/app/types/api.ts`, `template/apps/webapp/app/locales/en.json`, `template/apps/webapp/.storybook/preview.ts`, `template/.env.example`, `tools/sanitize.mjs`, `.github/workflows/ci.yml`, `docs/superpowers/phase-roadmap.md`.

---

## Task 1: Make the Storybook build actually build, and turn its gate on

**Why this is first.** `storybook` in `.github/workflows/ci.yml` is pull-request-only *and* `continue-on-error: true` *and* has failed on every run since it was added. Those three facts stack into one consequence: **no story file in this repository has ever been compiled by any gate.** Phase 3 shipped four stories on that basis. Phase 4 adds a fifth (Task 15), and it must not ship the same way. Mattia's ruling on 2026-09-21: root-cause it properly, however long it takes — this is a Phase 4 deliverable, not a timebox.

**The observed failure**, reproduced most recently on 2026-09-20 against a freshly generated project installed with `npm ci` from the committed lockfile:

```
✓ 0 modules transformed
[vite:build-html] Missing field `moduleType`
```

**Files:**
- Modify: `template/apps/webapp/.storybook/preview.ts`
- Modify: `template/apps/webapp/.storybook/main.ts` (only if the investigation implicates it)
- Modify: `template/apps/webapp/package.json` (only if the root cause is a version incompatibility)
- Modify: `template/package-lock.json` (only if the above happens; regenerate, do not hand-edit)
- Modify: `.github/workflows/ci.yml` — the `storybook` job and the comment block above it
- Create: `template/apps/webapp/app/test/storybook-config.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. This is the first task.
- Produces: a `build-storybook` that exits 0 in a generated project, and a CI job that blocks on it. Task 15 depends on this having happened.

- [ ] **Step 1: Reproduce, and capture the full output**

```bash
PROBE_ROOT=$(mktemp -d)
PROBE="$PROBE_ROOT/probe"
cd /Users/sinisimattia/Progetti/forge
npm run create -- --name probe --out "$PROBE_ROOT" --yes --no-git
cd "$PROBE" && npm ci
npx nx run webapp:build-storybook 2>&1 | tee "$PROBE_ROOT/storybook-build.log"
```

Expected: a non-zero exit, `✓ 0 modules transformed`, and the `moduleType` error. Keep `$PROBE` alive for the rest of this task — regenerating costs several minutes each time. Copy `storybook-build.log` into the task report directory before cleanup.

- [ ] **Step 2: Test the leading hypothesis — the preview entry does not resolve**

`template/apps/webapp/.storybook/preview.ts` line 2 is:

```ts
import '~/assets/css/main.css';
```

**That file does not exist.** `find template/apps/webapp -name 'main.css'` returns nothing; the webapp's stylesheet is `app/assets/scss/app.scss`, declared to Nuxt through `tailwindcss.cssPath` in `nuxt.config.ts`. An unresolvable import in the preview entry means the preview module never transforms, which is a plausible and checkable cause of `✓ 0 modules transformed` followed by an HTML plugin with no module graph to work from.

In the probe, edit `.storybook/preview.ts` to import the file that exists:

```ts
import type { Preview } from '@storybook-vue/nuxt';
import '~/assets/scss/app.scss';
```

Re-run `npx nx run webapp:build-storybook`. Record what changed — the error, the module count, both, or neither. **If this fixes it, it is still only half the finding:** say in the report why an import of a non-existent file produced *that* error rather than a resolve error, because the next person needs to recognise the shape.

- [ ] **Step 3: If Step 2 did not fix it, work the remaining hypotheses in this order**

Each is a single experiment with a recorded outcome. Do not batch them; a fix that lands with three changes in it teaches nobody which one mattered.

1. **`main.ts` imports a package that is not a declared dependency.** `.storybook/main.ts` imports `StorybookConfig` from `@storybook/vue3-vite`, which appears in neither `dependencies` nor `devDependencies` of `apps/webapp/package.json` — it resolves, if at all, transitively. Try `import type { StorybookConfig } from '@storybook-vue/nuxt'` (the framework package the config actually names) and re-run.
2. **Vite major-version incompatibility.** Nuxt 4.3 builds on Vite 7; Storybook is pinned at `~9.0.5` here. Check what Vite version `@storybook-vue/nuxt` resolves and whether `Missing field 'moduleType'` is a known Rolldown/Vite 7 plugin-interface error. `npm ls vite` in the probe. If the answer is a version floor, the fix is a bump in `apps/webapp/package.json` plus `npm run refresh-lockfile` at the Forge root — **not** a hand-edited lockfile.
3. **The `stories` glob matches nothing from the Storybook working directory.** `stories: ['../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)']` is relative to `.storybook/`. Verify it resolves to `apps/webapp/stories/` and not to something else under the Nuxt framework's own root. `✓ 0 modules transformed` is exactly what an empty glob produces, and this hypothesis explains the symptom without any import being broken at all — **check it even if Step 2 succeeded**, because two independent faults producing one symptom is how five fix rounds happen.

- [ ] **Step 4: Prove the stories are now actually compiled**

A build that exits 0 having transformed zero modules is the failure this task exists to end, so the evidence is not the exit code. Break one story deliberately and watch the build fail:

```bash
# in the probe
sed -i '' 's/import IdentityList from/import IdentityList from "~\/components\/organisms\/NoSuchComponent.vue"; import _unused from/' \
  apps/webapp/stories/organisms/IdentityList.stories.ts
npx nx run webapp:build-storybook   # expected: FAILS
git -C . checkout apps/webapp/stories/organisms/IdentityList.stories.ts 2>/dev/null || true
```

Record the module count from the passing run. A number greater than zero, and a red run when a story is broken, are the two facts that make this gate real. **Both go in the task report.**

- [ ] **Step 5: Add the config assertion that survives the next refactor**

Create `template/apps/webapp/app/test/storybook-config.spec.ts`:

```ts
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBAPP_ROOT = resolve(HERE, '../..');

/**
 * Storybook's entry files name paths, and a path that names nothing fails in a
 * way that reads as something else entirely: an unresolvable import in
 * `preview.ts` produced `✓ 0 modules transformed` and then a `moduleType` error
 * from the HTML plugin, which sent two phases of readers looking at Vite
 * versions. This suite asserts the paths exist, in the fast tier, so the next
 * one is a one-line failure with the filename in it.
 *
 * It does NOT replace the `storybook` CI job. It cannot: it reads text and
 * checks the filesystem, where the job builds. It exists because the job takes
 * minutes and this takes milliseconds.
 */
describe('storybook configuration', () => {
  it('every stylesheet preview.ts imports exists', async () => {
    const preview = await import('node:fs/promises')
      .then((fs) => fs.readFile(resolve(WEBAPP_ROOT, '.storybook/preview.ts'), 'utf8'));
    const imports = [...preview.matchAll(/^import ['"]~\/(.+?)['"];$/gm)].map((m) => m[1]);

    // A guard against the assertion passing by finding nothing to check — the
    // exact shape of "a check that cannot fail".
    expect(imports.length).toBeGreaterThan(0);
    for (const path of imports) {
      expect(existsSync(resolve(WEBAPP_ROOT, 'app', path))).toBe(true);
    }
  });

  it('the stories glob resolves to the directory the stories are in', async () => {
    const main = await import('node:fs/promises')
      .then((fs) => fs.readFile(resolve(WEBAPP_ROOT, '.storybook/main.ts'), 'utf8'));
    expect(main).toContain("'../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)'");
    expect(existsSync(resolve(WEBAPP_ROOT, 'stories'))).toBe(true);
  });
});
```

- [ ] **Step 6: Watch the new spec fail, then pass**

In the probe, revert `preview.ts` to the broken import, run `npx nx run webapp:test`, and confirm the first case is red naming the missing path. Restore the fix and confirm green. **Report both counts.**

- [ ] **Step 7: Flip the CI job**

In `.github/workflows/ci.yml`, in the `storybook` job: remove `continue-on-error: true`, and change `if: github.event_name == 'pull_request'` to `if: github.event_name != 'schedule'`. Rewrite the comment block above it — it currently explains at length why the job is known-red and non-blocking, and **every sentence of that explanation is now false**. Replace it with what was actually wrong, how it was found, and the one fact that matters to the next reader: that the exit code alone never proved anything here, because the build exits 0 over an empty module graph, so the job's value depends on the glob continuing to match.

- [ ] **Step 8: Clean up and commit**

```bash
rm -rf "$PROBE_ROOT"
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
git add template/apps/webapp/.storybook template/apps/webapp/app/test/storybook-config.spec.ts .github/workflows/ci.yml
# plus package.json/package-lock.json only if the root cause required them
git commit -m "fix(webapp): make the Storybook build compile stories, and make its gate block"
```

---

## Task 2: Teach `tools/sanitize.mjs` about no-separator compounds

**Why now, and why its own commit.** Triage item 3 from Phase 3: the bare-word term rules have no camelCase/PascalCase boundary handling, so `OrganizationInvitation` slips every rule that `organization-invitation` and `organization_invitation` are caught by. This is live — `template/apps/backend/src/mail/templates/organization-invitation.ts` ships today. Phase 4 adds `FederatedAccount`, `DevOAuthProvider` and a dozen other Pascal-case symbols to the template, so the gate's blind spot widens exactly as this phase writes into it. **A gate change never rides inside a feature task** (the Phase 3 Task 1 precedent): a feature task's diff is where a weakened gate hides.

**Files:**
- Modify: `tools/sanitize.mjs`
- Modify: `tests/unit/sanitize.spec.mjs` (or the existing sanitize test file — find it with `ls tests/unit/`)

**Interfaces:**
- Consumes: nothing.
- Produces: a sanitize gate that catches `SomeBannedTerm` as well as `some-banned-term`. Every later task's `npm run sanitize` runs against it.

- [ ] **Step 1: Read the rule you are changing**

```bash
cd /Users/sinisimattia/Progetti/forge
grep -n "event\|payment\|ticket\|invitation" tools/sanitize.mjs | head -40
ls tests/unit/
```

The `event`, `payment` and `ticket` rules already ban the source project's *compounds* rather than the bare noun — that shape is correct and is not what changes. What changes is the boundary detection those rules use when they look for a term inside a larger identifier.

- [ ] **Step 2: Write the failing test first**

Add to the sanitize unit suite a case per shape, driving the **shipped** function rather than a copy of its regex:

```js
test('a banned term is caught inside a PascalCase identifier', () => {
  // The exact shape that slipped: no separator, capital boundary.
  assert.ok(findsViolationIn('export class OrganizationInvitation {}'));
});

test('a banned term is caught inside a camelCase identifier', () => {
  assert.ok(findsViolationIn('const organizationInvitation = 1;'));
});

test('a word that merely contains the term as a substring is not a violation', () => {
  // The rule must not fire on a longer word that happens to contain the
  // letters — otherwise the next person turns it off rather than narrowing it.
  assert.ok(!findsViolationIn('const reinvitationless = 1;'));
});
```

Use whatever the existing suite's helper is named; do not invent a new harness beside it.

- [ ] **Step 3: Run the tests and watch the first two fail**

```bash
cd /Users/sinisimattia/Progetti/forge && npm test
```

Expected: the PascalCase and camelCase cases fail; the third passes already.

- [ ] **Step 4: Widen the boundary, not the term**

The rule must treat a capital letter as a word boundary in the same way `-` and `_` already are. Do **not** switch to a bare substring match — that is the move that makes a gate too noisy to keep. The boundary before the term is "start of string, a non-letter, or a lowercase-to-uppercase transition"; the boundary after it is "end of string, a non-letter, or an uppercase letter beginning the next word".

- [ ] **Step 5: Run the tests, then the gate, and see what the widened rule now finds**

```bash
npm test
npm run sanitize
```

`npm run sanitize` may now report violations that were always there and were never visible — `organization-invitation.ts`'s own symbols among them. **Each one is a decision, not a chore.** A term that is genuinely this template's own domain vocabulary (organizations, invitations, identities) belongs on the allow side; a term that is a source-project trace belongs gone. Record each in the task report with which it was and why. If the gate cannot be made green without either weakening a rule or renaming a shipped symbol, **stop and report the conflict** — that is the one case here worth escalating.

- [ ] **Step 6: Commit**

```bash
git add tools/sanitize.mjs tests/unit/
git commit -m "fix(sanitize): catch banned terms inside camelCase and PascalCase identifiers"
```

---

## Task 3: The rule, as a pure function in core

**This is the task D11 exists to protect.** Everything the backend does in Tasks 10–12 is I/O around this decision; the decision itself has no clock, no store and no transport, and is the only place that says an email match does not establish identity.

**Read before starting:** `template/libs/core/CLAUDE.md`, `template/libs/core/STANDARDS.md`, and `libs/core/src/identities/policies/assertAtLeastOneIdentityRemains.ts` — the existing policy this one sits beside, and the house style for how a rule's *order* is argued in its own TSDoc.

**Core vocabulary rule (R6):** core says **federated**, never **OAuth**. OAuth is a protocol, protocols are transport, and core may not name one — in prose or in a type name. D14 (`grep -riE "\bjwt\b|cookie|http" libs/core/src` → zero hits) does not currently spell "oauth", and that is not a licence: the purity rule is the rule, and the grep is one sampling of it. Nothing in this task may name an authorization code, a redirect URI, a token endpoint, a bearer token or a scope.

**Files:**
- Create: `template/libs/core/src/identities/types/FederatedAccount.ts`
- Create: `template/libs/core/src/identities/types/FederatedSignInInput.ts`
- Create: `template/libs/core/src/identities/types/FederatedSignInDecision.ts`
- Create: `template/libs/core/src/identities/enums/FederatedSignInOutcome.ts`
- Create: `template/libs/core/src/identities/policies/decideFederatedSignIn.ts`
- Create: `template/libs/core/src/identities/policies/decideFederatedLink.ts`
- Modify: `template/libs/core/src/identities/{types,enums,policies}/index.ts`
- Test: `template/libs/core/tests/identities/policies/decideFederatedSignIn.spec.ts`
- Test: `template/libs/core/tests/identities/policies/decideFederatedLink.spec.ts`

**Interfaces:**
- Consumes: `AuthProvider`, `AuthIdentity`, `AuthIdentityId`, `UserId`, `User`, `normalizeEmail`, `assertNever` — all existing.
- Produces, and Tasks 11 and 13 depend on these exact names:
  - `decideFederatedSignIn(input: FederatedSignInInput): FederatedSignInDecision`
  - `decideFederatedLink(input: FederatedLinkInput): FederatedLinkDecision`
  - `FederatedSignInOutcome.{SIGN_IN_EXISTING, PROVISION_NEW, REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT, REFUSE_UNVERIFIED_EMAIL}`
  - `FederatedLinkOutcome.{LINK, ALREADY_LINKED_TO_ACTOR, LINKED_TO_ANOTHER_ACCOUNT}`

- [ ] **Step 1: Write the failing suite first**

`template/libs/core/tests/identities/policies/decideFederatedSignIn.spec.ts`. **Note the path** — core's jest `testMatch` is `['<rootDir>/tests/**/*.spec.ts']`, so a spec under `src/**/__tests__/` would pass by never running.

```ts
import { AuthIdentity } from '../../../src/identities/entities/AuthIdentity';
import { AuthProvider } from '../../../src/identities/enums/AuthProvider';
import { FederatedSignInOutcome } from '../../../src/identities/enums/FederatedSignInOutcome';
import { decideFederatedSignIn } from '../../../src/identities/policies/decideFederatedSignIn';
import type { AuthIdentityId } from '../../../src/identities/types/AuthIdentityId';
import type { FederatedAccount } from '../../../src/identities/types/FederatedAccount';
import type { UserId } from '../../../src/users/types/UserId';

const ADA = 'user-ada' as UserId;
const OUTSIDER = 'user-outsider' as UserId;

function account(overrides: Partial<FederatedAccount> = {}): FederatedAccount {
  return {
    provider: AuthProvider.GOOGLE,
    subject: '117392044118',
    email: 'ada@example.test',
    emailVerified: true,
    displayName: 'Ada',
    ...overrides,
  };
}

function linked(userId: UserId): AuthIdentity {
  return new AuthIdentity({
    id: 'identity-1' as AuthIdentityId,
    userId,
    provider: AuthProvider.GOOGLE,
    providerAccountId: '117392044118',
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    lastUsedAt: null,
  });
}

describe('decideFederatedSignIn', () => {
  it('signs in the account the subject is already linked to', () => {
    const decision = decideFederatedSignIn({
      account: account(),
      linkedIdentity: linked(ADA),
      userWithMatchingEmail: null,
    });

    expect(decision).toEqual({
      outcome: FederatedSignInOutcome.SIGN_IN_EXISTING,
      userId: ADA,
      identityId: 'identity-1',
    });
  });

  it('signs in a linked subject even when the provider has stopped asserting a verified address', () => {
    // The link was established under these rules; the subject is the proof, not
    // the address. A provider that changes what it discloses must not lock
    // somebody out of an account they already hold.
    const decision = decideFederatedSignIn({
      account: account({ email: null, emailVerified: false }),
      linkedIdentity: linked(ADA),
      userWithMatchingEmail: null,
    });

    expect(decision.outcome).toBe(FederatedSignInOutcome.SIGN_IN_EXISTING);
  });

  it('refuses an unlinked subject whose address the provider has not verified', () => {
    const decision = decideFederatedSignIn({
      account: account({ emailVerified: false }),
      linkedIdentity: null,
      // Deliberately present: an unverified address must be refused BEFORE it is
      // compared with anything, so this account is never reached.
      userWithMatchingEmail: { id: ADA } as never,
    });

    expect(decision).toEqual({ outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL });
  });

  it('refuses an unlinked subject whose address the provider did not supply at all', () => {
    const decision = decideFederatedSignIn({
      account: account({ email: null, emailVerified: true }),
      linkedIdentity: null,
      userWithMatchingEmail: null,
    });

    expect(decision).toEqual({ outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL });
  });

  // ─── D11 ───────────────────────────────────────────────────────────────────
  it('refuses, and does NOT link, when a verified address belongs to an existing account', () => {
    const decision = decideFederatedSignIn({
      account: account(),
      linkedIdentity: null,
      userWithMatchingEmail: { id: OUTSIDER } as never,
    });

    expect(decision).toEqual({
      outcome: FederatedSignInOutcome.REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT,
      existingUserId: OUTSIDER,
    });
    // Stated as its own assertion because it is the property, not a detail of
    // the shape: no branch of this function ever answers SIGN_IN_EXISTING for a
    // subject that is not linked.
    expect(decision.outcome).not.toBe(FederatedSignInOutcome.SIGN_IN_EXISTING);
  });

  it('provisions a new account for a verified address nobody holds', () => {
    const decision = decideFederatedSignIn({
      account: account({ email: 'Ada@Example.test' }),
      linkedIdentity: null,
      userWithMatchingEmail: null,
    });

    expect(decision).toEqual({
      outcome: FederatedSignInOutcome.PROVISION_NEW,
      // Normal form, so the account created here and an account registered by
      // password at the same address are the same address.
      email: 'ada@example.test',
      displayName: 'Ada',
    });
  });
});
```

- [ ] **Step 2: Run it and watch every case fail**

```bash
# in a probe project (see Global Constraints for the procedure)
npx nx run core:test -- decideFederatedSignIn
```

Expected: FAIL, "Cannot find module '.../decideFederatedSignIn'".

- [ ] **Step 3: Write the types**

`FederatedAccount.ts`:

```ts
import type { AuthProvider } from '../enums/AuthProvider';

/**
 * What a federated provider asserted about the person in front of it.
 *
 * "Federated" rather than any protocol's name: how the assertion travelled is
 * the consuming application's business, and naming a protocol here would put a
 * transport into the one package whose value is that it carries none.
 *
 * Every field is what the provider *said*. Nothing here is established fact
 * until a rule in this package has decided what it means — which is the whole
 * reason {@link decideFederatedSignIn} exists as a separate step.
 */
export interface FederatedAccount {
  /** Which provider made the assertion. Never {@link AuthProvider.PASSWORD}. */
  readonly provider: AuthProvider;
  /**
   * The provider's own identifier for the account.
   *
   * Opaque, case-sensitive to whoever issued it, and **the only part of this
   * assertion that identifies anybody**. Stable across an address change at the
   * provider, which is precisely why it and not the address is what an identity
   * is keyed on.
   */
  readonly subject: string;
  /** The address the provider associates with the account, or `null` if it disclosed none. */
  readonly email: string | null;
  /**
   * Whether the provider says it has itself proven that address.
   *
   * A provider will hand over an address it has never verified. Treating one as
   * identity is an account-takeover path: anyone who can add an unverified
   * address at that provider could then claim the account holding it here.
   */
  readonly emailVerified: boolean;
  /** A human-readable name, if the provider disclosed one. Never used to identify. */
  readonly displayName: string | null;
}
```

`FederatedSignInOutcome.ts` (enum with string values, one member per ending), `FederatedSignInInput.ts` and `FederatedSignInDecision.ts` (the discriminated union, `readonly` throughout, one member per outcome carrying only what that outcome needs):

```ts
export type FederatedSignInDecision
  = | {
    readonly outcome: FederatedSignInOutcome.SIGN_IN_EXISTING;
    readonly userId: UserId;
    readonly identityId: AuthIdentityId;
  }
  | {
    readonly outcome: FederatedSignInOutcome.PROVISION_NEW;
    /** In normal form, so this address and a registered one are one address. */
    readonly email: string;
    readonly displayName: string | null;
  }
  | {
    readonly outcome: FederatedSignInOutcome.REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT;
    /** For the audit record. **Never returned to whoever made the attempt.** */
    readonly existingUserId: UserId;
  }
  | { readonly outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL };
```

- [ ] **Step 4: Write the rule**

```ts
/**
 * Which account, if any, a federated assertion corresponds to.
 *
 * ## The order of the four checks is the security property
 *
 * 1. **An already-linked subject signs in, first and unconditionally.** The link
 *    was established under these same rules; the subject is the proof. A
 *    provider that later stops disclosing a verified address must not lock
 *    somebody out of an account they already hold, which is what any ordering
 *    that checked the address first would do.
 * 2. **An unverified or absent address is refused before it is compared with
 *    anything.** Not after — a comparison that happens and is then discarded is
 *    one refactor away from a comparison that is acted on.
 * 3. **A verified address that belongs to an existing account is refused, and
 *    the assertion is NOT linked to it.** This is discriminating test D11 and
 *    the reason this function exists. A provider asserting an address proves it
 *    controls *that address at that provider*; it proves nothing about an
 *    account here that happens to answer to the same string. Silent linking on a
 *    provider-asserted address is a documented account-takeover path (spec
 *    §9.3): anyone able to create an account at any configured provider using
 *    somebody's address would inherit their account here. The remedy a person is
 *    given instead is the authenticated link flow — sign in the way you already
 *    can, then link the provider deliberately — which requires proving the
 *    account is yours first, and that is exactly the proof that was missing.
 * 4. **Everything left is a verified address nobody holds**, and becomes an
 *    account.
 *
 * Note what this function does **not** decide: whether the account it names may
 * actually be used. Deleted, suspended and unverified accounts are refused by
 * the same rule a password sign-in is refused by, applied by the caller, in the
 * order {@link AuthenticationRejectionReason} fixes. Deciding it twice would be
 * two rules that can disagree about whether a suspended account may sign in.
 *
 * Pure: no clock, no store, no I/O. Everything it needs is in `input`.
 *
 * @param input - the assertion, plus the two lookups only a store can do
 * @returns which of the four endings applies, and what that ending needs
 */
export function decideFederatedSignIn(input: FederatedSignInInput): FederatedSignInDecision {
  const { account, linkedIdentity, userWithMatchingEmail } = input;

  if (linkedIdentity !== null) {
    return {
      outcome: FederatedSignInOutcome.SIGN_IN_EXISTING,
      userId: linkedIdentity.userId,
      identityId: linkedIdentity.id,
    };
  }

  if (account.email === null || !account.emailVerified) {
    return { outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL };
  }

  if (userWithMatchingEmail !== null) {
    return {
      outcome: FederatedSignInOutcome.REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT,
      existingUserId: userWithMatchingEmail.id,
    };
  }

  return {
    outcome: FederatedSignInOutcome.PROVISION_NEW,
    email: normalizeEmail(account.email),
    displayName: account.displayName,
  };
}
```

- [ ] **Step 5: Run the suite and watch it pass**

```bash
npx nx run core:test -- decideFederatedSignIn
```

- [ ] **Step 6: Write `decideFederatedLink` and its suite**

Three endings, and the reason it is a separate function rather than a fifth outcome above: linking is asked by somebody who has **already proven who they are**, so "does this address belong to an existing account" is not a question that arises — the actor is the account.

```ts
export function decideFederatedLink(input: FederatedLinkInput): FederatedLinkDecision;
// LINK                     — nothing holds this subject
// ALREADY_LINKED_TO_ACTOR  — the actor already holds it; linking again is a no-op, not a failure
// LINKED_TO_ANOTHER_ACCOUNT — somebody else holds it; refused
```

Its suite covers all three. **`LINKED_TO_ANOTHER_ACCOUNT` must not disclose whose:** the decision carries no user id, unlike `REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT` above, because that one is consumed by an audit record the actor never sees and this one is consumed by a response the actor does see. Assert that the decision object has no `userId` key.

- [ ] **Step 7: Export everything, and run the whole core suite plus coverage**

Add each symbol to its folder's `index.ts`. Then:

```bash
npx nx run core:test
npx nx run core:coverage   # 100% thresholds — an unreachable branch fails here
npx nx run core:purity
npx nx run core:lint
grep -riE "\bjwt\b|cookie|http" libs/core/src   # D14: zero hits
grep -riE "oauth|authorization code|redirect uri|bearer" libs/core/src   # R6: zero hits
```

- [ ] **Step 8: Commit**

```bash
git add template/libs/core
git commit -m "feat(core): decide what a federated assertion means, without linking on an address"
```

---

## Task 4: The two audit actions this phase records

**Files:**
- Modify: `template/libs/core/src/audit/enums/AuditAction.ts`
- Modify: whichever suite pins the enum — find it with `grep -rn "AuditAction" template/libs/core/tests/`

**Interfaces:**
- Produces: `AuditAction.IDENTITY_LINKED` and `AuditAction.FEDERATED_LINK_REFUSED`. Tasks 11 and 13 record them.

- [ ] **Step 1: Add the two members with the TSDoc that says why each exists**

Appended to the end of the enum — **members are added and never renamed or removed**, because a stored value that changes meaning makes every historical entry a lie in a table nothing may correct. `IDENTITY_UNLINKED` already ships and has no partner; that is the first gap.

```ts
  /** A second way in was attached to an account that had proven itself first. */
  IDENTITY_LINKED = 'IDENTITY_LINKED',
  /**
   * A federated provider asserted an address that already belongs to an account,
   * and the assertion was refused rather than linked.
   *
   * The whole of discriminating test D11 lives on the other side of this entry.
   * Whoever made the attempt is told only that it failed; this is where the
   * server writes down what actually happened, and it is the entry a reader
   * looking for an attempted takeover would search for. The actor is the account
   * that already existed — nothing has been established about whoever made the
   * attempt, which is the point.
   */
  FEDERATED_LINK_REFUSED = 'FEDERATED_LINK_REFUSED',
```

- [ ] **Step 2: Run core's suite and coverage**

```bash
npx nx run core:test && npx nx run core:coverage
```

- [ ] **Step 3: Commit**

```bash
git add template/libs/core/src/audit
git commit -m "feat(core): record linking and the refusal to link"
```

---

## Task 5: The port, and which providers this deployment has

**Files:**
- Create: `template/apps/backend/src/auth/oauth/IOAuthProvider.ts`
- Create: `template/apps/backend/src/auth/oauth/oauth-provider.registry.ts`
- Create: `template/apps/backend/src/auth/oauth/oauth.config.ts`
- Create: `template/apps/backend/src/auth/oauth/index.ts`
- Test: `template/apps/backend/src/auth/oauth/__tests__/oauth.config.spec.ts`
- Test: `template/apps/backend/src/auth/oauth/__tests__/oauth-provider.registry.spec.ts`
- Modify: `template/.env.example`

**Interfaces:**
- Consumes: `FederatedAccount` (Task 3), `AuthProvider`.
- Produces, depended on by Tasks 6–8 and 10–12:
  - `interface IOAuthProvider { readonly provider: AuthProvider; authorizationUrl(p: AuthorizationUrlParams): string; fetchAccount(p: ExchangeParams): Promise<FederatedAccount>; }`
  - `const OAUTH_PROVIDERS: unique symbol` — the multi-provider DI token
  - `function buildOAuthProviders(config: ConfigService): IOAuthProvider[]` — **exported by name so a spec calls the shipped factory rather than a copy**
  - `class OAuthProviderRegistry { readonly available: readonly AuthProvider[]; find(name: string): IOAuthProvider | null }`

- [ ] **Step 1: Write the port**

```ts
/** Where the browser is sent, and what it must bring back. */
export interface AuthorizationUrlParams {
  /** The single-use value tying the callback to the request that began it. */
  readonly state: string;
  /** The PKCE challenge — the verifier's digest, never the verifier. */
  readonly codeChallenge: string;
  /** Where the provider returns the browser. A deployment-configured origin. */
  readonly redirectUri: string;
}

/** What the callback presents in exchange for the account behind it. */
export interface ExchangeParams {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

/**
 * One federated provider, stated as the capability rather than as a vendor.
 *
 * **Two methods, and the asymmetry between them is the security boundary.**
 * `authorizationUrl` builds a string the *browser* carries; nothing it returns
 * is trusted, because everything in it travels through a user agent that may
 * rewrite it. `fetchAccount` speaks to the provider directly, server to server,
 * over TLS, and what it returns is what this application acts on.
 *
 * That asymmetry is also why there is no ID-token verification anywhere behind
 * this port (ADR-0011): the access credential used to read the account was
 * obtained by this process from the provider's own endpoint, so the claim's
 * path of custody never included the browser. Verifying a signature would be
 * re-establishing a property the transport already gives, at the cost of JWKS
 * fetching, key rotation and algorithm selection — three surfaces this template
 * does not need to own.
 *
 * An implementation returns a {@link FederatedAccount} and **nothing else**: no
 * access credential, no refresh credential, no raw provider payload. A provider
 * credential this application keeps is a provider credential this application
 * can leak, and nothing here needs one after the exchange.
 */
export interface IOAuthProvider {
  /** Which provider this is. Never `AuthProvider.PASSWORD`. */
  readonly provider: AuthProvider;
  /** @returns the absolute URL to send the browser to */
  authorizationUrl(params: AuthorizationUrlParams): string;
  /** @returns what the provider asserts about the account that just approved this */
  fetchAccount(params: ExchangeParams): Promise<FederatedAccount>;
}

/** The multi-provider token. Every registered adapter is injected as one array. */
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
```

- [ ] **Step 2: Write the config factory's failing tests first**

`__tests__/oauth.config.spec.ts`. Drive **`buildOAuthProviders`** — the exported function `auth.module.ts` will use by reference — with a `ConfigService` built over a plain object:

```ts
function configOf(env: Record<string, string>): ConfigService {
  return new ConfigService(env);
}

describe('buildOAuthProviders', () => {
  it('registers nothing when nothing is configured', () => {
    expect(buildOAuthProviders(configOf({ PUBLIC_API_URL: 'http://localhost:3000' }))).toEqual([]);
  });

  it('registers Google only when both of its variables are present', () => {
    const half = buildOAuthProviders(configOf({
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_GOOGLE_CLIENT_ID: 'id',
      // secret absent
    }));
    expect(half).toEqual([]);
  });

  it('registers each fully configured provider once', () => {
    const built = buildOAuthProviders(configOf({
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_GOOGLE_CLIENT_ID: 'id', OAUTH_GOOGLE_CLIENT_SECRET: 'secret',
      OAUTH_GITHUB_CLIENT_ID: 'id', OAUTH_GITHUB_CLIENT_SECRET: 'secret',
    }));
    expect(built.map((p) => p.provider)).toEqual([AuthProvider.GOOGLE, AuthProvider.GITHUB]);
  });

  it('refuses to start when the development provider is configured in production', () => {
    expect(() => buildOAuthProviders(configOf({
      NODE_ENV: 'production',
      PUBLIC_API_URL: 'https://api.example.test',
      OAUTH_DEV_ENABLED: '1',
    }))).toThrow(/OAUTH_DEV_ENABLED/);
  });

  it('refuses at start-up rather than quietly declining to register', () => {
    // The distinction this asserts: a silent decline is the failure mode where a
    // staging configuration reaches production and nobody ever learns which half
    // of the condition saved them.
    let registered: IOAuthProvider[] | null = null;
    try {
      registered = buildOAuthProviders(configOf({
        NODE_ENV: 'production', PUBLIC_API_URL: 'https://api.example.test', OAUTH_DEV_ENABLED: '1',
      }));
    } catch { /* expected */ }
    expect(registered).toBeNull();
  });

  it('registers the development provider outside production', () => {
    const built = buildOAuthProviders(configOf({
      NODE_ENV: 'development',
      PUBLIC_API_URL: 'http://localhost:3000',
      OAUTH_DEV_ENABLED: '1',
    }));
    expect(built.map((p) => p.provider)).toEqual([AuthProvider.OIDC]);
  });
});
```

- [ ] **Step 3: Run it, watch it fail, then write the factory**

```bash
npx nx run backend:test -- oauth.config
```

The factory reads every variable through `ConfigService`, builds an adapter only when **every** variable that adapter needs is present and non-empty, and throws before building anything when `OAUTH_DEV_ENABLED` is set in production. Its error message must tell the operator what to do — unset the variable in this environment — and must **not** suggest changing `NODE_ENV`, which is the catastrophic remedy here.

`PUBLIC_API_URL` is required whenever any provider is configured, and is **deployment-configured, never read off an incoming request**. The reasoning is the one already written down in `apps/backend/src/mail/templates/reset-password.ts`: a redirect URI built from a request's `Host` header is a host-header-injection hazard, and here the consequence is an authorization code delivered to somebody else's origin. State that in the factory's TSDoc with the pointer.

- [ ] **Step 4: The registry, with a fail-closed lookup**

```ts
/**
 * Which providers this deployment has, and the only way to name one.
 *
 * `find` takes the raw route parameter and answers `null` for anything that is
 * not a provider this deployment actually registered. **A whitelist over the
 * registered adapters, not a cast into `AuthProvider` and not a check against
 * the enum's members**: the enum contains every provider that could ever exist,
 * so validating against it accepts `GITHUB` on a deployment that configured only
 * Google, and the flow then fails somewhere further in with something less
 * legible. Refusing what is not modelled, rather than enumerating what is
 * rejected, is the rule this repository settled on after five rounds of the
 * other approach in `migration-sql.spec.ts`.
 */
find(name: string): IOAuthProvider | null {
  return this.providers.find((candidate) => candidate.provider === name) ?? null;
}
```

Its spec asserts: a registered name resolves; an unregistered-but-real member (`'GITHUB'` when only Google is configured) answers `null`; `'PASSWORD'` answers `null`; and `''`, `'__proto__'` and `'google'` (wrong case) all answer `null`.

- [ ] **Step 5: Document the variables in `.env.example`**

Appended with a comment block in the file's established voice: what each provider needs, that an absent variable means an absent provider rather than an error, that `PUBLIC_API_URL` is the origin the provider sends the browser back to and must match what is registered at the provider, and — for `OAUTH_DEV_ENABLED` — that it is a provider which authenticates **nobody** and exists so a freshly generated project can exercise the flow with no developer application registered anywhere, which is why the application refuses to start if it is set in production.

- [ ] **Step 6: Gates, then commit**

```bash
npx nx run backend:test && npx nx run backend:lint && npx nx run backend:typecheck
cd /Users/sinisimattia/Progetti/forge && npm run sanitize
git commit -m "feat(backend): the federated-provider port, and which providers a deployment has"
```

---

## Task 6: The development adapter

**Why it exists:** ADR-0008 requires a development adapter behind every port, and without one a generated project cannot try OAuth at all until somebody registers a developer application at Google. **Why it is dangerous:** it is a provider that hands out sign-ins with no credential, so it is the one adapter whose absence in production has to be structural rather than conventional (R10, enforced in Task 5).

**Files:**
- Create: `template/apps/backend/src/auth/oauth/adapters/DevOAuthProvider.ts`
- Test: `template/apps/backend/src/auth/oauth/adapters/__tests__/DevOAuthProvider.spec.ts`

**Interfaces:**
- Consumes: `IOAuthProvider`, `FederatedAccount`, `AuthProvider.OIDC`.
- Produces: `class DevOAuthProvider implements IOAuthProvider`.

- [ ] **Step 1: Decide the shape, then write the tests**

`authorizationUrl` returns a URL on this application's **own** origin — a small page served by the backend that asks for an address and posts back to the callback with a code it just minted. `fetchAccount` resolves that code to a `FederatedAccount` with `emailVerified: true`.

The whole adapter is a few dozen lines and its tests assert exactly three things:

```ts
it('asserts the address the code was minted for, as verified', async () => { /* ... */ });

it('is the only adapter whose account assertion needs no network', async () => {
  // Not decoration: this is the property that makes it the development adapter.
  // If this class ever gains a fetch, it has stopped being one.
  expect(DevOAuthProvider.prototype.fetchAccount.toString()).not.toMatch(/fetch\(/);
});

it('refuses a code it did not mint', async () => {
  await expect(adapter.fetchAccount({ code: 'not-mine', codeVerifier: 'v', redirectUri: R }))
    .rejects.toThrow();
});
```

- [ ] **Step 2: Implement, run, and commit**

The class's TSDoc opens with what it is for and **what it must never be**, in the shape `NoOpBreachedPasswordRegistry`'s does — read that file first and match its voice. Include the sentence that the application refuses to start when this is configured in production, with the pointer to `oauth.config.ts` where that refusal lives, so a reader of this file does not have to take it on trust.

```bash
npx nx run backend:test -- DevOAuthProvider
git commit -m "feat(backend): a development federated provider that needs no account"
```

---

## Task 7: The Google and generic OIDC adapters

Batched into one task because they are the same shape: an OIDC authorization endpoint, an OIDC token endpoint, and an OIDC userinfo endpoint. Google's three are constants; the generic adapter reads them from the issuer's discovery document. **Review them as one diff.**

**Files:**
- Create: `template/apps/backend/src/auth/oauth/adapters/OidcOAuthProvider.ts`
- Create: `template/apps/backend/src/auth/oauth/adapters/GoogleOAuthProvider.ts`
- Create: `template/apps/backend/src/auth/oauth/adapters/oidc-exchange.ts` (the shared exchange, so the two adapters do not carry two copies of it)
- Test: `template/apps/backend/src/auth/oauth/adapters/__tests__/OidcOAuthProvider.spec.ts`
- Test: `template/apps/backend/src/auth/oauth/adapters/__tests__/GoogleOAuthProvider.spec.ts`

**Interfaces:**
- Consumes: `IOAuthProvider`, `ExchangeParams`, `AuthorizationUrlParams`, `FederatedAccount`.
- Produces: both classes, each with a constructor taking `{ clientId, clientSecret }` (plus `issuer` for the generic one).

- [ ] **Step 1: Write the tests first, against a stubbed `fetch`**

Inject `fetch` rather than reaching for the global, so the test drives the shipped class instead of a network. The constructor takes it with a default:

```ts
constructor(
  private readonly credentials: OAuthClientCredentials,
  private readonly http: typeof fetch = fetch,
) {}
```

The cases that matter, and each names the fault it catches:

```ts
it('sends the client secret in the request body, never in the URL', async () => {
  // A secret in a query string is a secret in every proxy log between here and
  // the provider.
  await adapter.fetchAccount(params);
  const [url, init] = http.mock.calls[0];
  expect(String(url)).not.toContain('secret');
  expect(String(init.body)).toContain('client_secret=');
});

it('sends the PKCE verifier, and never the challenge, to the token endpoint', async () => { /* ... */ });

it('reports an address the provider marked unverified as unverified', async () => {
  // The single most important line in this adapter: `email_verified` is a
  // boolean in the userinfo response and providers do send `false`. Coercing it,
  // defaulting it to true, or omitting it turns D11's refusal into a sign-in.
  stubUserinfo({ sub: 'x', email: 'ada@example.test', email_verified: false });
  await expect(adapter.fetchAccount(params)).resolves.toMatchObject({ emailVerified: false });
});

it('treats a missing email_verified as unverified', async () => {
  stubUserinfo({ sub: 'x', email: 'ada@example.test' });
  await expect(adapter.fetchAccount(params)).resolves.toMatchObject({ emailVerified: false });
});

it('throws when the token endpoint answers a non-2xx', async () => { /* ... */ });

it('throws when the userinfo response carries no subject', async () => {
  // A FederatedAccount with no subject identifies nobody, and an identity keyed
  // on an empty string is an identity every such response would match.
  stubUserinfo({ email: 'ada@example.test', email_verified: true });
  await expect(adapter.fetchAccount(params)).rejects.toThrow();
});
```

- [ ] **Step 2: Implement `oidc-exchange.ts`, then the two adapters**

The exchange is `POST` with `content-type: application/x-www-form-urlencoded`, body `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `client_id`, `client_secret`; then `GET` userinfo with `authorization: Bearer <access_token>`. Parse defensively: read only the four fields `FederatedAccount` needs, coerce nothing, and treat every absent field as absent rather than as a default.

The generic adapter fetches `${issuer}/.well-known/openid-configuration` once and caches the three endpoints for the process's lifetime. **Assert the discovered endpoints are `https:` and share the issuer's origin** before using them — a discovery document is fetched from a configured issuer, but the endpoints inside it are still data, and a provider-supplied `token_endpoint` pointing elsewhere would be handed this deployment's client secret.

- [ ] **Step 3: Run, gate and commit**

```bash
npx nx run backend:test -- OAuthProvider
npx nx run backend:lint && npx nx run backend:typecheck
git commit -m "feat(backend): Google and generic OIDC adapters behind the port"
```

---

## Task 8: The GitHub adapter

Its own task because GitHub is **not** an OIDC provider: there is no userinfo endpoint and no `email_verified` claim on a token. The account comes from `GET https://api.github.com/user`, and the verified address from `GET https://api.github.com/user/emails`, which returns a list where each entry carries `primary` and `verified`.

**Files:**
- Create: `template/apps/backend/src/auth/oauth/adapters/GitHubOAuthProvider.ts`
- Test: `template/apps/backend/src/auth/oauth/adapters/__tests__/GitHubOAuthProvider.spec.ts`

- [ ] **Step 1: Write the tests, and make the address rule explicit in them**

```ts
it('takes the primary address only when GitHub says it is verified', async () => {
  stubEmails([{ email: 'ada@example.test', primary: true, verified: true }]);
  await expect(adapter.fetchAccount(params))
    .resolves.toMatchObject({ email: 'ada@example.test', emailVerified: true });
});

it('reports no verified address when the primary one is unverified', async () => {
  // NOT "fall back to another verified address". The primary address is the one
  // the person publishes; silently substituting a different one changes which
  // account a later match would find, and does it invisibly.
  stubEmails([
    { email: 'ada@example.test', primary: true, verified: false },
    { email: 'other@example.test', primary: false, verified: true },
  ]);
  await expect(adapter.fetchAccount(params)).resolves.toMatchObject({ emailVerified: false });
});

it('reports no address at all when the scope did not include one', async () => {
  stubEmails([]);
  await expect(adapter.fetchAccount(params)).resolves.toMatchObject({ email: null, emailVerified: false });
});

it('keys the identity on the numeric id, not the login name', async () => {
  // A GitHub login can be changed and can be taken over by somebody else after
  // it is released. The numeric id cannot. An identity keyed on the login is an
  // identity that transfers with the name.
  stubUser({ id: 583231, login: 'octocat' });
  await expect(adapter.fetchAccount(params)).resolves.toMatchObject({ subject: '583231' });
});
```

- [ ] **Step 2: Implement, run, gate, commit**

GitHub's token endpoint answers `application/x-www-form-urlencoded` unless `accept: application/json` is sent — send it, and assert in a test that it is sent, because the failure without it is a parse error far from its cause. Both API calls need a `user-agent` header; GitHub rejects requests without one.

```bash
npx nx run backend:test -- GitHubOAuthProvider
git commit -m "feat(backend): the GitHub adapter, keyed on the account id and the verified primary address"
```

---

## Task 9: The authorization-request table

**Read first:** `template/apps/backend/src/db/__tests__/migration-sql.spec.ts` and `template/apps/backend/eslint-rules/migration-sql.mjs`. Migration SQL must be a **string literal** at the call site — the lint rule allows exactly one method (`query`) and the spec reads the migration's source as text through a canonicalizing lexer that **fails closed**. The spec also asserts the exact set of `eslint-disable` exemptions in the directory; **this migration must add none.** If it seems to need one, the statement is wrong, not the guard.

**Files:**
- Create: `template/apps/backend/src/db/migrations/1758000004000-OAuthAuthorizationRequests.ts`
- Create: `template/apps/backend/src/auth/oauth/oauth-authorization-request.entity.ts`
- Modify: `template/apps/backend/src/app.module.ts` — the `entities` array in `typeOrmOptions`
- Modify: `template/apps/backend/src/db/__tests__/migration-sql.spec.ts`
- Modify: `template/apps/backend/src/__tests__/composition-root.spec.ts`

**Interfaces:**
- Produces: `OAuthAuthorizationRequestRecord`, and the table Tasks 10 and 11 read and write.

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE oauth_authorization_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash     text        NOT NULL UNIQUE,
  code_verifier  text        NOT NULL,
  provider       text        NOT NULL,
  purpose        text        NOT NULL,
  user_id        uuid        NULL REFERENCES users (id) ON DELETE CASCADE,
  redirect_to    text        NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz NULL
)
```

with an index on `expires_at` for the sweep, and a `COMMENT ON` in the voice the other migrations use. Each column's reason, written where the next reader will find it:

- **`state_hash`, not `state`.** The state value travels through the browser and through the provider's logs. Storing its digest means a leak of this table is not a set of usable pending authorizations — the same reason `refresh_tokens` and `email_verification_tokens` store digests.
- **`UNIQUE` on it**, so a reused state is a constraint violation rather than a race two requests both win. `FakeDataSource` enforces no unique constraints, so this is invisible to the fast tier and is asserted in the real-database tier or nowhere — say so in the spec that covers it.
- **`code_verifier` in the clear**, deliberately, and this is the one asymmetry worth arguing in the file: the verifier is what *this server* proves to the provider, so it must be recoverable here, where the state value is what a *caller* proves to this server and therefore must not be. Hashing the verifier would make the exchange impossible; the two are opposite kinds of secret.
- **`purpose`**, because the callback must not learn its own purpose from the request that reached it (R4).
- **`user_id` nullable with `ON DELETE CASCADE`** — set only for a link, and a deleted account leaves no pending authorizations behind that could complete against it.
- **`consumed_at`**, so a second presentation is visible rather than merely refused.
- **No foreign key from anywhere in this table to `audit_entries`**, and nothing in this migration touches that table. The rule is absolute.

`down()` drops the table.

- [ ] **Step 2: Extend `migration-sql.spec.ts`**

Add the assertions that hold for this migration: that its SQL is literal, that the `purpose` values written by `oauth.service.ts` match the literals in this file (the same drift check the `'PASSWORD'` predicate already has), and that the exemption set for the directory is **unchanged**. Run the whole spec and confirm the count went up and nothing went red.

- [ ] **Step 3: Register the entity in two places, and assert both**

Add `OAuthAuthorizationRequestRecord` to `typeOrmOptions`' `entities` array in `app.module.ts`. Add the corresponding assertion to `__tests__/composition-root.spec.ts` — **an entity dropped from that list is a repository Nest cannot resolve, and a review once deleted `RefreshTokenRecord` with all 165 tests staying green.** Watch the new assertion fail with the entity removed, then pass.

- [ ] **Step 4: Run it against a real database**

```bash
# in a probe project, with the dev stack up
npx nx run backend:test
npm run dev:up     # then, in another shell:
npm run dev:migrate
```

Confirm the migration applies and reverts cleanly. **Do not touch any container you did not create** — check with `docker ps` first, and bring up only the probe's own stack.

- [ ] **Step 5: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge && npm run sanitize
git commit -m "feat(backend): the authorization-request table, single-use and hashed"
```

---

## Task 10: Beginning an authorization — both entry points

**Files:**
- Create: `template/apps/backend/src/auth/oauth/pkce.ts`
- Create: `template/apps/backend/src/auth/oauth/oauth.service.ts` (the `begin` half)
- Test: `template/apps/backend/src/auth/oauth/__tests__/pkce.spec.ts`
- Test: `template/apps/backend/src/auth/oauth/__tests__/oauth.service.begin.spec.ts`

**Interfaces:**
- Consumes: `OAuthProviderRegistry`, `OAuthAuthorizationRequestRecord`, `generateOpaqueToken`/`hashOpaqueToken` from `src/common/crypto`.
- Produces, depended on by Tasks 11 and 12:
  - `OAuthService.begin(providerName: string, redirectTo: string | null): Promise<string>` — the absolute URL to send the browser to
  - `OAuthService.beginLink(actorId: UserId, providerName: string): Promise<string>` — same, with the purpose and actor recorded
  - `OAuthAuthorizationPurpose = 'SIGN_IN' | 'LINK'`

- [ ] **Step 1: PKCE, from `node:crypto` only**

```ts
/**
 * A PKCE verifier and its challenge.
 *
 * The verifier is 32 random bytes in base64url — 43 characters, inside RFC
 * 7636's 43–128 range. The challenge is its SHA-256 digest, base64url, which is
 * the `S256` method; the `plain` method is not offered and must not be added,
 * because a challenge equal to its verifier gives an attacker who intercepts the
 * authorization request everything needed to complete the exchange, which is the
 * whole thing PKCE exists to prevent.
 */
export function createPkcePair(): { verifier: string; challenge: string };
```

Its spec asserts: the verifier is 43 characters of base64url; two calls differ; the challenge is the digest of the verifier (computed independently in the test, not by calling the same helper); and the challenge never equals the verifier.

- [ ] **Step 2: Write `begin`'s tests first**

```ts
it('refuses a provider this deployment did not configure', async () => {
  await expect(service.begin('GITHUB', null)).rejects.toThrow(NotFoundException);
});

it('stores the state as a digest and never in the clear', async () => {
  const url = new URL(await service.begin('GOOGLE', null));
  const state = url.searchParams.get('state')!;
  const rows = await requests.find();
  expect(rows).toHaveLength(1);
  expect(rows[0].stateHash).not.toBe(state);
  expect(rows[0].stateHash).toBe(hashOpaqueToken(state));
});

it('sends the challenge to the provider and keeps the verifier here', async () => {
  const url = new URL(await service.begin('GOOGLE', null));
  const rows = await requests.find();
  expect(url.searchParams.get('code_challenge')).not.toBe(rows[0].codeVerifier);
  expect(url.search).not.toContain(rows[0].codeVerifier);
});

it('records the purpose, and records no actor, for a sign-in', async () => { /* SIGN_IN, userId null */ });

it('records the actor for a link', async () => { /* LINK, userId = actor */ });

it('gives the authorization a short life', async () => {
  // Minutes, not the session's lifetime. A pending authorization is a thing
  // somebody can be walked into completing.
  const rows = await requests.find();
  expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBeLessThanOrEqual(10 * 60 * 1000);
});

it('refuses a redirectTo that leaves this application', async () => {
  // An open redirect on the sign-in path is a phishing primitive: a link that
  // genuinely signs somebody in and then lands them somewhere else entirely.
  await expect(service.begin('GOOGLE', 'https://elsewhere.example/steal')).rejects.toThrow();
  await expect(service.begin('GOOGLE', '//elsewhere.example')).rejects.toThrow();
  await expect(service.begin('GOOGLE', '/organizations')).resolves.toBeDefined();
});
```

- [ ] **Step 3: Implement, run, commit**

`redirectTo` is accepted only as a path beginning with a single `/` and not `//`; everything else is refused. **Do not enumerate the bad forms** — accept the one shape that is modelled and refuse the rest.

```bash
npx nx run backend:test -- oauth.service.begin pkce
git commit -m "feat(backend): begin a federated authorization, for signing in and for linking"
```

---

## Task 11: Completing an authorization — the decision, applied

The heart of the phase. `complete` is the only method that turns a provider's assertion into a session or an identity, and every refusal it makes is one somebody will try to argue their way past.

**Files:**
- Modify: `template/apps/backend/src/auth/oauth/oauth.service.ts` (the `complete` half)
- Test: `template/apps/backend/src/auth/oauth/__tests__/oauth.service.complete.spec.ts`

**Interfaces:**
- Consumes: `decideFederatedSignIn`, `decideFederatedLink` (Task 3), `SessionService.beginIn`, `AuditService.recordIn`, `IdentitiesService`, `AuthService.toUser` and the rejection ordering.
- Produces: `OAuthService.complete(providerName: string, code: string, state: string, client: ClientContext): Promise<CompletedAuthorization>` where

```ts
type CompletedAuthorization =
  | { status: 'SIGNED_IN'; credentials: IssuedCredentials; redirectTo: string | null }
  | { status: 'LINKED'; redirectTo: string | null }
  | { status: 'REFUSED'; code: FederatedRefusalCode; redirectTo: string | null };

/** The opaque codes the callback may put in a redirect. This repository owns every one. */
type FederatedRefusalCode =
  | 'AUTHORIZATION_EXPIRED' | 'AUTHORIZATION_UNKNOWN' | 'PROVIDER_UNAVAILABLE'
  | 'EMAIL_UNVERIFIED' | 'EMAIL_ALREADY_REGISTERED' | 'IDENTITY_ALREADY_LINKED'
  | 'ACCOUNT_UNAVAILABLE';
```

- [ ] **Step 1: Write the tests first — one per branch, and the refusals matter more than the successes**

```ts
describe('the authorization row', () => {
  it('refuses a state nothing answers to', /* AUTHORIZATION_UNKNOWN */);
  it('refuses a state whose authorization has expired', /* AUTHORIZATION_EXPIRED */);
  it('refuses a state that has already been consumed', /* AUTHORIZATION_UNKNOWN, and see below */);
  it('marks the authorization consumed before the exchange, not after', async () => {
    // A provider that is slow, or an exchange that throws, must not leave the
    // authorization presentable a second time. Consumed-then-exchanged is the
    // ordering that survives a failure in between.
  });
  it('refuses a callback arriving at a provider other than the one it began at', async () => {
    // The row records which provider issued the authorization. A code minted by
    // one provider, presented at another's callback, is refused on the row —
    // never on the code, which this application cannot read.
  });
});

describe('signing in', () => {
  it('signs in the account the subject is already linked to, and issues a session', /* ... */);
  it('records LOGIN_SUCCEEDED and updates the identity lastUsedAt', /* ... */);

  it('refuses a suspended account, and issues nothing', async () => {
    // R8: the same account-state rule a password sign-in is subject to, in the
    // same order. A suspended account must not be reachable through a provider.
    // The reason is recorded and never returned.
    const result = await service.complete(/* ... */);
    expect(result).toEqual({ status: 'REFUSED', code: 'ACCOUNT_UNAVAILABLE', redirectTo: null });
    expect(await sessions.count()).toBe(0);
    expect(auditOf(AuditAction.LOGIN_FAILED)[0].metadata)
      .toMatchObject({ reason: AuthenticationRejectionReason.ACCOUNT_SUSPENDED });
  });

  it('refuses a deleted account with the same outward answer as a suspended one', async () => {
    // Indistinguishable to the caller, distinguished in the record.
  });

  it('provisions an account for a verified address nobody holds, already verified', async () => {
    const result = await service.complete(/* ... */);
    expect(result.status).toBe('SIGNED_IN');
    const [user] = await users.find();
    // The provider proved the address. Sending a verification mail to an address
    // a provider just proved would be asking the person to prove it twice.
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(auditOf(AuditAction.USER_REGISTERED)).toHaveLength(1);
  });
});

// ─── D11, at the service level ─────────────────────────────────────────────
describe('an address that already belongs to an account', () => {
  it('refuses, links nothing, and issues nothing', async () => {
    const before = await identities.count();
    const result = await service.complete(/* google asserts ada@example.test, verified */);

    expect(result).toEqual({
      status: 'REFUSED', code: 'EMAIL_ALREADY_REGISTERED', redirectTo: null,
    });
    expect(await identities.count()).toBe(before);
    expect(await sessions.count()).toBe(0);
  });

  it('records FEDERATED_LINK_REFUSED against the account that already existed', async () => {
    // The actor is the existing account, not whoever made the attempt — nothing
    // has been established about them, which is the point.
    expect(auditOf(AuditAction.FEDERATED_LINK_REFUSED)[0].actorUserId).toBe(ADA);
  });

  it('answers the same way whether or not the address has an account', async () => {
    // Deliberately NOT asserted, and the reason is written here rather than left
    // as an omission: this refusal IS distinguishable from the provisioning
    // path, because one signs the person in and one does not, and no arrangement
    // of this flow can hide that. What the refusal must not do is say WHOSE
    // account it is, which the code above pins.
  });
});

describe('linking', () => {
  it('links the subject to the actor the authorization recorded', /* ... */);
  it('records IDENTITY_LINKED', /* ... */);
  it('refuses a subject another account already holds, without saying whose', /* IDENTITY_ALREADY_LINKED */);
  it('treats a subject the actor already holds as done, not as an error', /* ... */);
  it('links regardless of what address the provider asserted', async () => {
    // The actor proved who they are before this flow began. The address plays no
    // part in a link and must not: making a link conditional on an address match
    // would be the auto-link rule wearing the opposite hat.
  });
});
```

- [ ] **Step 2: Run the suite and watch it all fail, then implement**

`complete` in outline — and the ordering is the design:

1. Resolve the provider through the registry. Unknown → `PROVIDER_UNAVAILABLE`.
2. Read the authorization row by `hashOpaqueToken(state)`, **inside a transaction, with a write lock**, exactly as `verifyEmail` does — two simultaneous presentations of one state must not both succeed, and without the lock both read `consumed_at IS NULL`.
3. Refuse on: no row, `consumed_at` set, `expires_at` past, or `provider` ≠ the callback's provider.
4. Mark consumed. **Then** exchange.
5. `fetchAccount`. A throw becomes `PROVIDER_UNAVAILABLE` — never the provider's own error text, which is attacker-influenced text this application would be rendering.
6. Look up the linked identity by `(provider, subject)` and, for `SIGN_IN`, the user by normalized address.
7. Call `decideFederatedSignIn` or `decideFederatedLink`. **Switch exhaustively, ending in `assertNever`.**
8. Apply the decision, and for `SIGN_IN_EXISTING` apply the account-state rules first.

Audit every branch. The refusals are the entries somebody will actually come looking for.

- [ ] **Step 3: Prove the rule is load-bearing — the injection**

Before the task is done, inject the auto-link fault and watch tests go red:

```ts
// In decideFederatedSignIn, replace the D11 branch with the fault:
if (userWithMatchingEmail !== null) {
  return { outcome: FederatedSignInOutcome.SIGN_IN_EXISTING,
           userId: userWithMatchingEmail.id, identityId: '?' as AuthIdentityId };
}
```

Run `npx nx run backend:test` and `npx nx run core:test`. **Record the exact counts — green before, red after, and which suites.** Revert the injection. If fewer than two suites go red, the coverage is thinner than it reads and the task is not done.

- [ ] **Step 4: Gates and commit**

```bash
npx nx run backend:test && npx nx run backend:lint && npx nx run backend:typecheck
git commit -m "feat(backend): complete a federated authorization, refusing to link on an address"
```

---

## Task 12: The routes, the wiring, and the error surface

**Files:**
- Create: `template/apps/backend/src/auth/oauth/oauth.controller.ts`
- Create: `template/apps/backend/src/auth/oauth/dto/` (`provider-list-response.dto.ts`, `begin-link-response.dto.ts`)
- Modify: `template/apps/backend/src/identities/identities.controller.ts` — add `POST /users/me/identities/:provider`
- Modify: `template/apps/backend/src/auth/auth.module.ts` and `template/apps/backend/src/identities/identities.module.ts`
- Modify: `template/apps/backend/src/app.module.ts`
- Test: `template/apps/backend/src/auth/oauth/__tests__/oauth.controller.spec.ts`
- Modify: `template/apps/backend/src/__tests__/composition-root.spec.ts`, `template/apps/backend/src/__tests__/guard-wiring.spec.ts` (only if it needs nothing — see below)

**Interfaces:**
- Produces, and Tasks 14–17 consume these exact shapes:
  - `GET /auth/oauth/providers` → `{ providers: AuthProvider[] }`, `@Public()`
  - `GET /auth/oauth/:provider?redirectTo=/path` → `302` to the provider, `@Public()`
  - `GET /auth/oauth/:provider/callback?code=&state=` → `302` to the webapp, `@Public()`
  - `POST /users/me/identities/:provider` → `{ authorizationUrl: string }`, authenticated

- [ ] **Step 1: Write the controller spec first**

```ts
it('lists only the providers this deployment configured', /* ... */);

it('lists nothing, rather than failing, when none are configured', async () => {
  // An unconfigured provider is absent from the login page, never a crash and
  // never a button that fails when someone presses it (ADR-0008).
  expect(await controller.providers()).toEqual({ providers: [] });
});

it('redirects to the provider and sets no cookie on the way out', /* ... */);

it('sets the renewal cookie and redirects to the webapp on a successful sign-in', async () => {
  // R5: the credential is in a cookie, and the URL carries nothing.
  expect(response.cookie).toHaveBeenCalledWith(REFRESH_COOKIE.name, expect.any(String), expect.anything());
  expect(location).not.toContain(credentials.accessToken);
  expect(location).not.toContain(credentials.refreshToken);
});

it('puts no provider-supplied text in the redirect', async () => {
  // The provider's error is data from somewhere else. What is rendered is one of
  // this repository's own codes.
  const location = await callbackWith({ providerThrows: new Error('<script>whatever</script>') });
  expect(location).toContain('error=PROVIDER_UNAVAILABLE');
  expect(location).not.toContain('script');
});

it('redirects, rather than answering a status code, on every refusal', async () => {
  // The caller is a browser that followed a redirect here. A JSON 400 shows a
  // person a raw error document on an origin they did not choose to visit.
});

it('requires a proven identity to begin a link', async () => {
  // The link route carries no @Public(), so the global JwtAuthGuard closes it.
  // Asserted by reading the metadata off the shipped handler, not by calling it.
  expect(Reflect.getMetadata(IS_PUBLIC_KEY, IdentitiesController.prototype.beginLink)).toBeUndefined();
});
```

- [ ] **Step 2: Implement the controller**

Every route on `OAuthController` is `@Public()` and the reasons differ per route — write each one down. `providers` is public because the login page is; `:provider` is public because somebody signing in has no credential yet; the callback is public because the caller is the provider's redirect, which carries nothing of ours but the state.

The callback catches everything. **No exception may escape it**: an unhandled throw on a redirect endpoint is an error page on this application's origin, in the middle of somebody signing in. Every failure becomes `302` to the webapp with a code.

- [ ] **Step 3: Wire the modules, and assert the wiring**

`OAuthService`, `OAuthController` and the `OAUTH_PROVIDERS` factory go in `AuthModule` (it already owns `SessionService` and the refresh cookie). `IdentitiesModule` imports what `beginLink` needs. Add `OAuthAuthorizationRequestRecord` to both `TypeOrmModule.forFeature` and the `typeOrmOptions` entity list.

Then extend `__tests__/composition-root.spec.ts` with the assertions for each new registration, and run `__tests__/guard-wiring.spec.ts` unchanged — **it discovers guards from `@UseGuards` metadata, so it needs no edit and must not be converted into a list.** If it fails, the fix is the module, not the spec.

- [ ] **Step 4: Watch the wiring assertions fail**

Delete `OAuthController` from `AuthModule`'s `controllers`, run the backend suite, confirm red, restore. Same for the entity-list entry. **Report both counts.**

- [ ] **Step 5: Boot the real application**

```bash
# in a probe project
npm run dev:up    # the generated stack, NOT any container you did not create
curl -fsS localhost:3000/health
curl -fsS localhost:3000/auth/oauth/providers
```

A green fast tier says nothing about whether the application boots — Phase 3 shipped an `UnknownDependenciesException` that survived every fast tier for a whole phase. Confirm the container is up and both endpoints answer before committing.

- [ ] **Step 6: Commit**

```bash
cd /Users/sinisimattia/Progetti/forge && npm run sanitize
git commit -m "feat(backend): the federated sign-in and linking routes"
```

---

## Task 13: D11, as a discriminating test

**Files:**
- Create: `template/apps/backend/src/__tests__/discriminating/d11-federated-email-match.spec.ts`
- Modify: `template/apps/backend/src/__tests__/discriminating/world.ts` if it needs a federated fixture

**Read first:** `d9-tenant-isolation.spec.ts`, and the roadmap's note on it — D9's natural fault turned out to be **fail-closed**, so the test only discriminated because of a contrived fixture, and the fault that could actually leak was a different one. Do the same analysis here **before** writing the spec.

**Interfaces:**
- Consumes: everything from Tasks 11 and 12, through the HTTP surface rather than through the service, because D11 is a statement about what the application does.

- [ ] **Step 1: Name the fault, and check whether it is fail-closed**

The fault D11 exists to catch is: *a callback whose provider-asserted address matches an existing account links the provider to that account and signs the caller in as them.* Write it down as a patch, apply it, and measure.

This fault is **not** fail-closed — it succeeds, and it succeeds silently, which is why it is the one in the spec's table. Confirm that by measurement rather than by assertion: apply the patch, run the whole backend suite, and record how many tests go red and whether any of them is a refusal assertion rather than a control. Report the numbers.

- [ ] **Step 2: Write the spec**

Through `supertest` against a real Nest application with a stubbed provider adapter, so that what is under test is the shipped controller, service, decision and audit path.

```ts
it('does not link, and does not sign in, when the provider asserts an address an account already holds', async () => {
  // Ada holds a password account at ada@example.test. A Google callback arrives
  // asserting a VERIFIED ada@example.test for a subject nobody has ever linked.
  const response = await request(app.getHttpServer())
    .get(`/auth/oauth/GOOGLE/callback?code=${CODE}&state=${state}`);

  expect(response.status).toBe(302);
  expect(response.headers.location).toContain('error=EMAIL_ALREADY_REGISTERED');

  // The three facts, each asserted against the store rather than the response:
  expect(response.headers['set-cookie']).toBeUndefined();          // no session
  expect(await identitiesOf(ADA)).toHaveLength(1);                 // still only the password
  expect(await sessionsOf(ADA)).toHaveLength(0);                   // and none was begun
});

it('records the attempt against the account that already existed', async () => {
  const [entry] = await auditOf(AuditAction.FEDERATED_LINK_REFUSED);
  expect(entry.actorUserId).toBe(ADA);
});

it('lets Ada reach the same provider deliberately, from an authenticated session', async () => {
  // The remedy, asserted beside the refusal — because a refusal with no route
  // forward is a bug report waiting to be filed, and because this is the proof
  // the refusal is about PROOF rather than about the provider.
  const { authorizationUrl } = await authenticatedAs(ADA).post('/users/me/identities/GOOGLE');
  const linked = await request(app.getHttpServer()).get(callbackFor(authorizationUrl));
  expect(linked.status).toBe(302);
  expect(await identitiesOf(ADA)).toHaveLength(2);
});
```

The third case is what makes the suite a statement about the design rather than about a refusal: the same provider, the same subject, the same address — and it links, because this time the account was proven first.

- [ ] **Step 3: Inject the fault and watch it go red**

Apply the Step 1 patch, run this spec, and record which cases fail and with what. Revert. **A case that stays green under the fault is a case that is not testing D11**, whatever its name says.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(backend): D11 — a provider-asserted address links nothing"
```

---

## Task 14: The webapp's client half — fetchers, service, stub

**Read first:** `app/fetchers/identity.fetchers.ts`, `app/services/identity.service.ts`, `app/services/__tests__/stubBackend.ts`. Match their shape exactly; this task adds a fourth service beside three that already agree with each other.

**Files:**
- Create: `template/apps/webapp/app/fetchers/oauth.fetchers.ts`
- Create: `template/apps/webapp/app/services/oauth.service.ts`
- Modify: `template/apps/webapp/app/fetchers/index.ts`, `app/services/index.ts`
- Modify: `template/apps/webapp/app/services/__tests__/stubBackend.ts`
- Test: `template/apps/webapp/app/services/__tests__/oauth.service.spec.ts`

**Interfaces:**
- Produces, consumed by Tasks 15–17:
  - `OAuthHttpService.listProviders(): Promise<AuthProvider[]>`
  - `OAuthHttpService.beginLink(provider: AuthProvider): Promise<string>` — the authorization URL
  - `authorizationPathFor(provider: AuthProvider, redirectTo: string | null): string` — the path the browser navigates to for sign-in

**There is no core contract for this service, and that is deliberate (DEC-1).** `IIdentityService`'s own TSDoc says linking is not part of it, because an identity comes into being alongside the proof it stands for. A federated authorization is that proof arriving over a transport, so the contract for it is the backend's route surface, not a core interface. **Do not add these methods to `IIdentityService`** — every implementation of that contract would then owe a redirect it has no way to perform, and the webapp stub would satisfy it by lying, which is precisely the defect DEC-1 exists to prevent. Say so in the service's TSDoc.

- [ ] **Step 1: The sign-in entry point is a navigation, not a fetch**

`authorizationPathFor` returns a **path**, and the page assigns it to `window.location`. It is not a `fetch`: the browser must follow the redirect to the provider's own origin, which a `fetch` cannot do and must not try to. Write that in the function's TSDoc — it is the one thing about this module that reads like an oversight and is not.

- [ ] **Step 2: Tests, then implementation, then the stub**

The service's spec asserts the request shapes and that `beginLink` carries the access credential (it is an authenticated route). `stubBackend.ts` gains the two endpoints so the composable tests in Task 15 have a backend to talk to.

- [ ] **Step 3: Gates and commit**

```bash
npx nx run webapp:test && npx nx run webapp:lint && npx nx run webapp:typecheck
git commit -m "feat(webapp): the federated sign-in and linking client"
```

---

## Task 15: The provider buttons

**Task 1 must be complete before this task adds a story file.** If it is not, stop and report it: shipping a fifth unverified story is the exact thing this phase was told not to do.

**Files:**
- Create: `template/apps/webapp/app/composables/useOAuthProviders.ts`
- Create: `template/apps/webapp/app/components/organisms/OAuthButtons.vue`
- Create: `template/apps/webapp/stories/organisms/OAuthButtons.stories.ts`
- Test: `template/apps/webapp/app/components/__tests__/OAuthButtons.spec.ts`
- Test: `template/apps/webapp/app/composables/__tests__/useOAuthProviders.spec.ts`
- Modify: `template/apps/webapp/app/pages/login.vue`, `app/locales/en.json`

**Interfaces:**
- Consumes: `OAuthHttpService` (Task 14), `AuthProvider`.
- Produces: `<OAuthButtons :providers="..." :busy="..." @choose="..." />`, presentational in the way `IdentityList` is — the composable does the reading and the page does the navigating.

- [ ] **Step 1: Tests first, and the empty case is the one that matters**

```ts
it('renders one button per configured provider', /* ... */);

it('renders nothing at all when no provider is configured', () => {
  // Not an empty list with a divider and a heading above it. ADR-0008: an
  // unconfigured provider is ABSENT from the login page. A generated project
  // with no provider configured must look like a project that has no federated
  // sign-in, not like one whose buttons are missing.
  const wrapper = mount(OAuthButtons, { props: { providers: [] } });
  expect(wrapper.html()).toBe('');
});

it('labels each provider from the same Record IdentityList uses', () => {
  // A Record over core's enum, so a provider added there is a compile error
  // here rather than a button labelled with a raw enum value.
});

it('never renders PASSWORD as a button', () => {
  // It is a member of the enum and it is not a federated provider. The backend
  // never lists it; this asserts the component does not render one if it ever
  // arrives.
});
```

- [ ] **Step 2: Implement, wire into `login.vue`, add the locale keys**

`useOAuthProviders` reads the list once, treats a failure as "no providers" rather than as an error banner — a login page that cannot reach the provider list must still let somebody sign in with a password — and says so in its TSDoc.

- [ ] **Step 3: The story, and proof the gate now reads it**

Write `OAuthButtons.stories.ts` in the shape of `IdentityList.stories.ts`, with a `NoneConfigured` story for the empty case. Then, in a probe, run `npx nx run webapp:build-storybook` and confirm the module count includes it. **Break the story import deliberately and watch the build fail**, then restore. Report both.

- [ ] **Step 4: Gates and commit**

```bash
npx nx run webapp:test && npx nx run webapp:lint && npx nx run webapp:typecheck
git commit -m "feat(webapp): provider buttons that are absent when a provider is not configured"
```

---

## Task 16: The callback page

**Files:**
- Create: `template/apps/webapp/app/pages/oauth/callback.vue`
- Test: `template/apps/webapp/app/pages/__tests__/auth-pages.spec.ts` (extend)
- Modify: `template/apps/webapp/app/types/api.ts`, `app/locales/en.json`

**Interfaces:**
- Consumes: the `?error=<code>` values from Task 11's `FederatedRefusalCode`, and the auth store's renewal.

- [ ] **Step 1: The success path is a renewal, not a token read**

The backend set the renewal cookie and redirected here with no credential in the URL (R5). The page renews through the store — the same path `app/plugins/auth-init.client.ts` uses — and then goes where `redirectTo` said, or to `/`. It reads no token from the query string and must not be made to; add a test asserting the page ignores a `token` or `accessToken` parameter entirely, so that a later "convenience" cannot be added without turning a test red.

- [ ] **Step 2: Every refusal code has a message, and an unknown one has a fallback**

Mirror the `DOMAIN_ERROR_CODES` arrangement in `app/types/api.ts`: a hand-maintained snapshot of the backend's list, sorted with **`localeCompare`**, matching the backend's own comparator. Triage item 2 from Phase 3 was exactly this list disagreeing on sort order because one side used bare `sort()`; do not reintroduce it. Add a test that the two lists are sorted by the same comparator.

`EMAIL_ALREADY_REGISTERED` gets the message that carries the remedy: sign in the way you already can, then link the provider from account settings. That sentence is the human half of D11 and is worth writing carefully.

- [ ] **Step 3: Gates and commit**

```bash
npx nx run webapp:test && npx nx run webapp:lint && npx nx run webapp:typecheck
git commit -m "feat(webapp): the federated callback page, and a name for every refusal"
```

---

## Task 17: Linking and unlinking, on the identities screen

**Files:**
- Modify: `template/apps/webapp/app/components/organisms/IdentityList.vue`
- Modify: `template/apps/webapp/app/composables/useIdentities.ts`
- Modify: `template/apps/webapp/app/pages/account/identities.vue`
- Modify: `template/apps/webapp/stories/organisms/IdentityList.stories.ts`
- Test: extend `app/components/__tests__/IdentityList.spec.ts`, `app/composables/__tests__/accountComposables.spec.ts`

- [ ] **Step 1: Tests first**

```ts
it('offers a link control for each configured provider the account does not hold', /* ... */);
it('offers no link control for a provider the account already holds', /* ... */);
it('offers no link control for a provider this deployment has not configured', /* ... */);

it('still hides the unlink control at one identity, and still does not enforce the rule', () => {
  // Unchanged from Phase 3, and the existing comment on this component says why:
  // hiding a control that would certainly be refused is an affordance, not a
  // decision. Linking does not change that, and this case exists so the next
  // edit does not quietly make it a decision.
});
```

- [ ] **Step 2: `useIdentities.link(provider)` navigates; it does not fetch and wait**

It calls `beginLink`, then assigns `window.location`. The composable's TSDoc says why the function returns a promise that never resolves in the browser.

- [ ] **Step 3: Gates and commit**

```bash
npx nx run webapp:test && npx nx run webapp:lint && npx nx run webapp:typecheck
git commit -m "feat(webapp): link a federated provider from the identities screen"
```

---

## Task 18: ADR-0011, and the documentation that ships with a generated project

**Files:**
- Create: `template/docs/adrs/0011-federated-identity-never-auto-links.md`
- Modify: `template/docs/adrs/README.md`, `template/docs/adrs/0005-identity-is-separate-from-user.md` (a "Relates to" line), `template/docs/adrs/0008-ports-not-vendors.md` (name the new port among its examples)
- Modify: `template/CLAUDE.md`, `template/libs/core/CLAUDE.md` (the domain list), `template/README.md` if it enumerates features
- Modify: `template/.env.example` if Task 5 left anything undocumented

- [ ] **Step 1: Write the ADR**

In the voice of `0009-two-database-roles.md` — context, decision, consequences, with the negatives written honestly. It must record:

- **The decision:** a federated provider's assertion about an address never links to an existing account. Linking requires an authenticated session.
- **Why the obvious alternative is wrong**, with the attack stated concretely enough that somebody tempted to "improve the onboarding flow" reads it and stops.
- **R2's trade:** no ID-token verification, why the transport already gives the property, and what a deployment that needs an ID-token claim would have to do.
- **R10:** the development adapter and the start-up refusal, and why a silent decline was rejected.
- **The negatives.** A person with a password account who clicks "Sign in with Google" is refused and has to sign in another way first. That is friction, it will be reported as a bug, and the ADR is what the person triaging it should read. Also: spec §9.3's verified-email challenge is **not** built, so the authenticated session is the only route to a link.

- [ ] **Step 2: Update `libs/core/CLAUDE.md`'s domain inventory** — the `identities/` domain gained `policies/` entries and types. Its current text says to read the tree rather than trust the list's shape; keep that true.

- [ ] **Step 3: Sanitize, and commit**

```bash
cd /Users/sinisimattia/Progetti/forge && npm run sanitize
git commit -m "docs: ADR-0011 — a federated address links nothing"
```

---

## Task 19: Extend the Docker end-to-end walk

**Files:**
- Modify: `tests/integration/` — the Docker e2e (`FORGE_E2E=1`), the one that walks a booted generated stack

**Read first:** the existing walk. Phase 3 extended it to organizations and tenancy; this extends it to federated sign-in using the **development adapter**, which is why that adapter exists.

- [ ] **Step 1: Add the walk**

With `OAUTH_DEV_ENABLED=1` in the stack's environment: `GET /auth/oauth/providers` lists it; a sign-in through it creates an account and returns a renewal cookie; the same flow a second time signs in the same account rather than creating a second; a linked subject is listed by `GET /users/me/identities`; and — the one that matters — a dev-provider callback asserting an address that a password account already holds **does not** link.

- [ ] **Step 2: Assert the production refusal in the real image**

Boot the stack with `NODE_ENV=production` **and** `OAUTH_DEV_ENABLED=1` and assert the backend container exits rather than serving. This is R10's guarantee, and a unit test on a factory function is not the artifact that ships — the image is.

- [ ] **Step 3: Check Docker headroom before starting, and clean up after**

```bash
docker run --rm alpine df -h /    # floor 3 GB; never `docker system df`
docker ps                          # know which containers are NOT yours before you start
```

Bring down only the stack you brought up. **Never stop, remove or reconfigure a container you did not create** — this machine runs unrelated live containers including a Postgres on 5432.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(integration): walk federated sign-in, linking, and the refusal to auto-link"
```

---

## Task 20: The decision log and the roadmap

The artifact Phase 5 reads first. Phase 3's is 746 lines and is the model.

**Files:**
- Create: `docs/superpowers/phase-4-decision-log.md`
- Modify: `docs/superpowers/phase-roadmap.md`

- [ ] **Step 1: Write the decision log**

Sections, in the shape Phase 3's uses: **the handful worth knowing** · **formulations that earned their place** · **measurements** (every injection count this phase recorded, with the suite names) · **where this plan was wrong** (one row per correction made in flight, with what it cost) · **my own claims corrected** · **the rulings R1–R12, and which survived contact** · **documented, not fixed** · **out of Phase 4** · **the triage**.

Two things it must carry forward explicitly:

- **What the Storybook root cause actually was** (Task 1). Two phases of readers looked at Vite versions. Whatever it turns out to be, the log is where the next person finds it in one place.
- **The verified-email challenge is not built** (R9), with the pointer to spec §9.3 and to ADR-0011, so Phase 5 does not rediscover it as a gap.

- [ ] **Step 2: Update the roadmap**

Mark Phase 4 **BUILT**. Rewrite "What Phase 4 must not get wrong" as **"What Phase 5 must not get wrong"** from this phase's own discoveries. Update the Storybook entry under "Two things Phase 3 knowingly did not close" — if Task 1 closed it, say so and delete the exit condition rather than leaving a satisfied condition sitting there as though it were open. Carry forward every triage item this phase did not close, and add the ones it created.

- [ ] **Step 3: Final gates, whole branch**

```bash
cd /Users/sinisimattia/Progetti/forge
npm run sanitize
npm test
npm run test:integration
git -C ~/Progetti/Voku status --porcelain      # empty
git -C ~/Progetti/Voku rev-parse HEAD          # fdfdbdeae2891954dd1cac538a082d5837f281dd
```

- [ ] **Step 4: Commit**

```bash
git commit -m "docs(phase-4): the decision log and the roadmap"
```

---

## What is deliberately not in this phase

Recorded here so a reviewer does not read an omission as an oversight:

- **MFA** — Phase 5, spec §9.3. Nothing in this phase may add an `AuthenticationStatus` member; the `MFA_REQUIRED` branch is Phase 5's, and the discriminated union is already shaped to receive it.
- **The verified-email challenge for linking** (R9). Spec §9.3 offers it as an alternative to the authenticated session, and the authenticated session is what ships.
- **A provider-asserted display label on an identity** (R11).
- **Anything touching `libs/core/src/authorization/`.** No new `Permission`, no new layer, and no new `can()` call site that passes a resource — D12's tripwire stays untripped.
- **A foreign key on `audit_entries`**, now and permanently.
