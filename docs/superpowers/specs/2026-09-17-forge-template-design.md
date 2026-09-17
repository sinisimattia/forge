# Forge — Application Template Workspace

**Status:** approved design (v3), pending implementation plan
**Date:** 2026-09-17
**Source of truth for extraction:** `~/Progetti/Voku` @ `fdfdbde` (read-only)
**Supersedes:** v1 (layered composition, minimal auth), v2 (single template, basic auth)

---

## 1. Context

Voku is an NX/npm-workspaces monorepo whose reusable value is not its domain but its
scaffolding: a consolidated agent roster, single-source standards docs, a framework-agnostic
`libs/core` acting as an executable contract, a containerized Node 22 dev environment, and a
documented lifecycle (`planner → core-implementer → implementers → testers ‖ reviewer →
documenter → closer → pr`).

Rebuilding that by hand per application is expensive and lossy. Forge extracts it once into a
standalone template that generates new projects.

Forge is a **clean one-time snapshot**. It is not an upstream, does not sync, and never
modifies Voku.

## 2. Goals

- G1. A new application — correctly structured, with a complete identity, tenancy and
  authorization platform, passing its own lint/typecheck/test/build gates — is one command
  away.
- G2. The "how we work" layer (agents, standards, docs conventions) can also be adopted into a
  repository that already exists.
- G3. Exactly one way to generate a project. No composition, no variants, no matrix.
- G4. Zero Voku domain concepts survive extraction.

## 3. Non-goals

- N1. No changes of any kind to `~/Progetti/Voku`.
- N2. No layer system, presets, or stack variants. One template.
- N3. No second stack. Always NX + NestJS/TypeORM/Postgres + Nuxt 4/Vue 3.
- N4. No GitHub remote creation, no push, no npm publish. Local repo only.
- N5. No drift/update tooling. A receipt is written so it stays possible; it is not built.
- N6. Forge does not dogfood its own template on itself.

## 4. Approach

**One template tree, copied wholesale.** `template/` is an ordinary, complete, bootable
monorepo. The generator copies it, substitutes tokens, and initializes git.

Rejected: *layered composition* (v1) — a dependency graph, topological sort, JSON deep-merge
and seam files bought the ability to mix stacks, which is not wanted (N3); *template engines*
(Plop/Hygen) — turning every file into a `.hbs` makes the template unrunnable and unlintable in
place, so you could no longer boot it to check it still works.

## 5. Repository layout

```
forge/
├── template/             # THE template — a complete monorepo, rooted at the target repo root
├── tools/create/         # the generator (zero runtime dependencies)
├── tests/                # unit + integration tests for the generator
├── docs/                 # forge's OWN docs (forge ADRs, this spec)
├── CLAUDE.md
└── README.md
```

## 6. Tokens

Substituted in **file contents and in path segments**, so `libs/core/package.json` holding
`"name": "__FORGE_SCOPE__/core"` generalizes `@voku/core` correctly.

| Token | Example | Source |
|---|---|---|
| `__FORGE_NAME__` | `my-app` | prompted; must match `^[a-z][a-z0-9-]*$` |
| `__FORGE_TITLE__` | `My App` | derived: title-cased from name |
| `__FORGE_SCOPE__` | `@my-app` | derived: `@` + name |
| `__FORGE_DESCRIPTION__` | `An app.` | prompted, may be empty |
| `__FORGE_DB_NAME__` | `my_app` | derived: name with `-` → `_`; `^[a-z][a-z0-9_]*$` |

After substitution the generator **fails** if any `__FORGE_[A-Z0-9_]*__` token survives. The
`__FORGE_` prefix is load-bearing: a bare `__NAME__` convention would make that guard fire on
legitimate shipped content — Nuxt's `window.__NUXT__` is the obvious casualty.

Binary files are detected by a NUL byte in the first 8 KiB and copied verbatim.

## 7. The generator

```
# create mode — a new project
npm run create -- --name <kebab> [--title <s>] [--scope <@s>] [--description <s>]
                  [--db-name <s>] [--out <parent-dir>] [--no-git] [--yes]

# adopt mode — the process subset into a repo that already exists (G2)
npm run create -- --into <existing-dir>
```

Zero runtime dependencies — `node:fs`, `node:path`, `node:readline/promises` on Node 22.

**Create mode:** prompt → stage into a temp directory (never the target) → substitute tokens,
failing on any survivor → refuse a non-empty target, then atomically rename temp into place →
write `forge.json`, `git init`, one initial commit → report next steps. A failed run leaves
nothing behind, so there is never a half-generated repo to clean up.

`--out` defaults to the current working directory; the target is `<out>/<name>`.

**Adopt mode** copies only the **process subset** and **never overwrites**; skipped files are
listed in a closing report. The subset is one declared array in `tools/create/subset.mjs`:
`CLAUDE.md`, `.claude/agents/**`, `.claude/agent-memory/**`, `docs/standards/**`,
`docs/adrs/0000-template.md`, `docs/adrs/000{1,2,3,4}-*.md`.

`forge.json` receipt — `{ forgeCommit, generatedAt, mode, tokens{} }`; all values non-secret by
construction. Exit codes: `0` ok · `1` validation · `2` target conflict · `3` internal.

## 8. Template contents

### 8.1 Workspace shell

`package.json` (workspaces `apps/*` + `libs/*`, NX `build`/`test`/`lint`/`typecheck`/`affected`
scripts, `dev:*`/`prod:*` docker scripts, `engines: node >=22 <23`), `nx.json`,
`eslint.config.base.mjs`, base `tsconfig`, `.editorconfig`, `.gitignore`, `.env.example`,
`compose.yaml` + `compose.prod.yaml` (workspace + postgres),
`.github/workflows/ci.yml` (nx-affected on Node 22).

### 8.2 Agents and docs

```
CLAUDE.md                            # root orientation, real package table
.claude/agents/                      # all 11 agents + README
.claude/agent-memory/reviewer/       # .gitkeep
docs/standards/                      # README, agent-playbook, data-conventions, formatting,
                                     #   git, i18n, naming, testing, typing
docs/adrs/                           # 0000-template.md + convention ADRs 0001-0004
                                     #   + platform ADRs 0005-0008 (§9.1)
docs/{rfcs,architecture,guides,concepts,api}/   # skeletons, each with a README
docs/superpowers/{specs,plans}/      # where brainstorming and writing-plans land
```

Roster carried over unchanged in shape: `planner`, `reviewer`, `documenter`, `closer`, `pr`,
`core-implementer`, `core-tester`, `backend-implementer`, `backend-tester`,
`webapp-implementer`, `webapp-tester`. Frontmatter keeps Voku's fields and model assignments.

**Reviewer.** The dimension-*selection* machinery is kept, but checklists move into each
package's `STANDARDS.md` under a `## Review dimensions` table (`ID | Check | Signal | Severity
| Source`). Rules live next to the package they govern and the reviewer prompt stays thin.

**Inherited convention ADRs** — re-authored from Voku ADRs that are reusable conventions rather
than product decisions: `0001-single-source-documentation` (ADR-0008's surviving rule),
`0002-consolidated-agent-roster` (ADR-0009), `0003-architecture-docs-describe-boundaries`
(ADR-0010), `0004-api-reference-lives-with-implementation` (ADR-0013). Voku's product ADRs do
not cross over.

**Scope limit, stated honestly:** `docs/standards/*` is framework-agnostic but unmistakably
TypeScript-flavored. It is not abstracted into language-neutral prose.

### 8.3 `libs/core`

The framework-agnostic domain and executable contract. Voku's layout rules carry over
verbatim: per-domain folders (`entities/ contracts/ enums/ errors/ types/ testing/`), one file
per symbol, barrel `index.ts` per folder, subpath-only exports, specific `DomainError`
subclasses, TSDoc as definition-of-done, money as integer cents, UTC `Date` in entities and
ISO-8601 on the wire.

**Purity is enforced structurally, not only by review.** Voku relies on the reviewer agent
alone; Forge adds `no-restricted-imports` to `libs/core/eslint.config.mjs` banning `typeorm`,
`@nestjs/*`, `nuxt`, `vue`, `pinia`, `@prisma/*`, `@simplewebauthn/*`, and `otplib`. The
reviewer's prose dimension remains, because lint cannot read TSDoc intent.

### 8.4 `apps/backend`

NestJS: `src/{auth,identities,mfa,users,organizations,authorization,audit,common,db/migrations,
health,i18n,mail}`, `Dockerfile`, `project.json`, jest config, `CLAUDE.md`, `STANDARDS.md`.

### 8.5 `apps/webapp`

Nuxt 4: `app/{components,composables,fetchers,services,stores,pages,layouts,locales,middleware,
utils,types}`, Storybook (atoms/molecules/organisms), Tailwind, vitest, `Dockerfile`,
`CLAUDE.md`, `STANDARDS.md`.

## 9. The identity, tenancy and access platform

Every generated project starts with this as real, kept code. It is also the worked example of
the core-first pattern: contracts in `libs/core`, implemented by both apps, checked by one
conformance suite.

### 9.1 Design principles

Four decisions shape everything below, each recorded as a platform ADR in the template so a
generated project inherits the reasoning:

- **ADR-0005 — Identity is separate from user.** A `User` is a person; an `AuthIdentity` is one
  way to prove you are them. Password is simply the `PASSWORD` provider. OAuth providers and
  account linking then fall out of the model instead of being bolted onto it, and "link a
  second login" is a row, not a feature.
- **ADR-0006 — Authorization is a pure function in core.** `can(principal, permission,
  resource?)` lives in `libs/core` as pure logic over role→permission maps and explicit grants.
  The backend calls it to **enforce**; the webapp calls the *same code* to decide what to
  render. One source of truth for access, no drift between what the UI offers and what the API
  allows.
- **ADR-0007 — Tenancy is explicit, never ambient.** Every tenant-scoped query takes an
  `organizationId` argument. There is no implicit "current org" hidden in async-local storage,
  because the failure mode of ambient tenancy is silent cross-tenant data leakage.
- **ADR-0008 — Ports, not vendors.** Mail, OAuth providers and secret storage are interfaces
  with a dev adapter shipped. The template binds no third-party account and carries no keys.

**Core purity note.** `libs/core` models `Session`, `AuthenticationOutcome` and
`MfaChallenge` as domain concepts. It does **not** name JWTs, cookies, headers or HTTP — the
purity rule in `libs/core/STANDARDS.md` forbids transport specifics in core, in prose as well
as imports. Token format and transport are backend concerns.

### 9.2 Core domains

```
libs/core/src/
├── shared/           # DomainError, ConformanceExpect, branded ids, Result types
├── users/            # User, IUserService, UserStatus, profile rules
├── identities/       # AuthIdentity, AuthProvider, IIdentityService, linking rules
├── auth/             # Session, AuthenticationOutcome, MfaChallenge, IAuthService
├── mfa/              # MfaMethod, MfaMethodType, RecoveryCode, IMfaService
├── organizations/    # Organization, Membership, OrgRole, Invitation, IOrganizationService
├── authorization/    # Permission, ROLE_PERMISSIONS, ResourceGrant, can(), IAuthorizationService
└── audit/            # AuditEntry, AuditAction, IAuditService
```

### 9.3 Identity and authentication

**Providers.** `AuthProvider = PASSWORD | GOOGLE | GITHUB | OIDC`. Concrete providers are
adapters behind one `IOAuthProvider` port; Google and GitHub ship as implementations and a
generic OIDC adapter covers the rest. **A provider self-registers only when its environment
variables are present** — an unconfigured provider is absent from the login page, never a
crash or a broken button.

**Password identity.** argon2id hashing, a configurable strength policy, breach-list hook
point, and rehash-on-login when parameters change.

**Account linking.** A signed-in user can link and unlink identities, with the invariant that
**at least one usable identity must remain**. An OAuth callback whose email matches an existing
account does **not** auto-link: it requires either an authenticated session or a verified-email
challenge. Silent linking on a provider-asserted email is a well-known account-takeover path,
so the model refuses it structurally.

**MFA.** `MfaMethodType = TOTP | WEBAUTHN`. Login becomes two-phase when any method is
enrolled: credentials verify, then the backend returns a short-lived, single-purpose
**challenge token** that can do nothing but complete MFA — never an access token. Recovery
codes are generated once, stored hashed, single-use. Removing the last MFA method requires
re-authentication.

**Sessions.** Short-lived access tokens plus **rotating refresh tokens**, persisted hashed and
revocable. Presenting an already-used refresh token **revokes the whole family** (reuse
detection). Sessions are listable and individually revocable by their owner; `logout-all`
revokes every session.

**Registration and recovery.** Email verification and password reset use single-use, expiring,
hashed tokens. Login and forgot-password return **identical responses for known and unknown
emails**, so neither enumerates accounts. Unverified, suspended and deleted accounts cannot
obtain tokens. `DELETE /users/me` soft-deletes and revokes all sessions.

### 9.4 Organizations and membership

`Organization` is the tenant. `Membership` binds a user to an organization with an
`OrgRole = OWNER | ADMIN | MEMBER | VIEWER`. A user may belong to many organizations, and their
role differs per organization — which is why roles are **not** a field on `User`.

`User.platformRole = PLATFORM_ADMIN | PLATFORM_USER` remains separate for operating the
deployment itself. Platform admin is not an org role and is never implied by one.

**Invitations** are email-based, single-use, expiring, and carry the intended role. Accepting
one while signed out routes through registration and then consumes the invitation.

**Invariants:** an organization always has at least one `OWNER`; the last owner can neither
leave nor be demoted; deleting an organization cascades memberships and invitations and is
audit-logged.

**Scope call, flagged for review:** this ships **one level of grouping** — organizations with
memberships, which is what most products call "teams". Nested teams *inside* an organization
are not included; that is a second grouping level that multiplies the authorization surface,
and it is listed in §9.8 rather than assumed.

### 9.5 Authorization

Three layers, evaluated in order by `can()`:

1. **Platform role** — `PLATFORM_ADMIN` passes everything, and every such pass is audit-logged.
2. **Organization role** — `ROLE_PERMISSIONS: Record<OrgRole, Permission[]>`, a static map in
   core. `Permission` is a `resource:action` string union (`organization:update`,
   `member:invite`, `audit:read`, …), so a typo is a compile error rather than a silent deny.
3. **Resource grant** — `ResourceGrant { subjectUserId, resourceType, resourceId, permission,
   grantedBy, expiresAt? }` for the exceptions roles cannot express ("this one user may edit
   this one record"). Grants are additive only; they never widen into another tenant, because
   `can()` requires the resource's `organizationId` to match the principal's membership.

Backend enforcement: `PermissionsGuard` + `@RequirePermission('member:invite')`, layered under
a globally-applied `JwtAuthGuard` with an explicit `@Public()` opt-out — a new endpoint is
authenticated and authorized unless it says otherwise.

Webapp: a `useCan()` composable calling the same core `can()`, so a button is hidden by exactly
the rule that would have rejected the request.

### 9.6 Audit log

`AuditEntry { id, actorUserId?, organizationId?, action, resourceType, resourceId?, metadata,
ip, userAgent, createdAt }`. **Append-only**: `IAuditService` exposes `record()` and `query()`
and no mutation methods, and the migration grants the application role `INSERT`/`SELECT` only
on the table — the guarantee is structural, not a convention.

Written for every authentication event, membership and role change, invitation, permission
grant, platform-admin override, and destructive action. Queryable by org admins, scoped to
their organization; `PLATFORM_ADMIN` may query across tenants.

### 9.7 Endpoint surface

| Module | Endpoints |
|---|---|
| Registration | `POST /auth/register`, `/auth/verify-email`, `/auth/resend-verification` |
| Password session | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all` |
| Password recovery | `POST /auth/forgot-password`, `/auth/reset-password`, `PATCH /auth/change-password` |
| OAuth | `GET /auth/oauth/:provider`, `GET /auth/oauth/:provider/callback` |
| Identities | `GET /users/me/identities`, `POST /users/me/identities/:provider`, `DELETE /users/me/identities/:id` |
| MFA | `POST /auth/mfa/verify`, `/mfa/totp/enroll`, `/mfa/totp/confirm`, `/mfa/webauthn/options`, `/mfa/webauthn/verify`, `DELETE /mfa/:id`, `POST /mfa/recovery-codes` |
| Sessions | `GET /users/me/sessions`, `DELETE /users/me/sessions/:id` |
| Profile | `GET /users/me`, `PATCH /users/me`, `DELETE /users/me` |
| Platform admin | `GET /users`, `GET /users/:id`, `PATCH /users/:id/platform-role`, `PATCH /users/:id/status` |
| Organizations | `POST /organizations`, `GET /organizations`, `GET/PATCH/DELETE /organizations/:id` |
| Members | `GET /organizations/:id/members`, `PATCH /organizations/:id/members/:userId`, `DELETE …` |
| Invitations | `POST /organizations/:id/invitations`, `GET …`, `DELETE …/:inviteId`, `POST /invitations/:token/accept` |
| Grants | `GET/POST /organizations/:id/grants`, `DELETE /organizations/:id/grants/:grantId` |
| Audit | `GET /organizations/:id/audit`, `GET /audit` (platform admin) |

Migrations: `users`, `auth_identities`, `sessions`, `refresh_tokens`,
`email_verification_tokens`, `password_reset_tokens`, `mfa_methods`, `mfa_recovery_codes`,
`organizations`, `memberships`, `organization_invitations`, `resource_grants`, `audit_entries`.

### 9.8 Webapp surface

Services implementing the core contracts over HTTP and driven by the same conformance suites;
fetchers, `useAuth`/`useCurrentUser`/`useOrganization`/`useCan` composables, Pinia stores for
auth and the active organization, and route middleware (`auth`, `guest`, `permission`).

Pages: login (with provider buttons for configured providers only), register, verify-email,
forgot/reset password, MFA challenge, `account/{profile,security,sessions,identities}`,
organization switcher, `organizations/{settings,members,invitations,audit}`, and
invitation-accept. Auth and org components ship with Storybook stories and `en` locale strings.

### 9.9 Still not included

Nested teams inside organizations (§9.4), SAML/SCIM enterprise provisioning, API keys and
machine-to-machine tokens, per-field permissions, and self-service billing.

## 10. Generated project shape

```
my-app/
├── CLAUDE.md, README.md, forge.json
├── package.json, nx.json, tsconfig.base.json, eslint.config.base.mjs
├── compose.yaml, compose.prod.yaml, .env.example
├── .github/workflows/ci.yml
├── .claude/agents/ (11), .claude/agent-memory/
├── docs/{standards,adrs,rfcs,architecture,guides,concepts,api,superpowers}/
├── libs/core/        → shared, users, identities, auth, mfa, organizations,
│                        authorization, audit
└── apps/
    ├── backend/      → those modules + common, db/migrations, health, i18n, mail
    └── webapp/       → auth/org pages, services, stores, composables, middleware, stories
```

`npm install && npm run dev:up` gives a running stack where you can register, verify, enrol
MFA, log in, create an organization, invite a colleague, grant a permission and read the audit
trail — with no domain code to delete first.

## 11. Testing

**Unit** (`tools/create/__tests__/`) — token substitution (contents, paths, binary passthrough,
unresolved-token failure), adopt-mode subset selection, never-overwrite.

**Integration** — generate into a temp directory, assert the file inventory, then run
`npm install && npm run lint && npm run typecheck && npm run test && npm run build` *inside the
generated repo*. If a generated repo cannot pass its own gates, forge is broken, and only
running them proves otherwise.

**Docker e2e** (`FORGE_E2E=1`, set in CI) — drive the real stack: register → verify → enrol
TOTP → login through the MFA challenge → create an org → invite and accept → grant a
permission → read the audit trail → rotate a refresh token → reset the password.

**Discriminating (negative) tests.** A green suite is not evidence on its own; each asserts a
*failure* that must occur:

| # | Injected fault / probe | Must fail |
|---|---|---|
| D1 | unresolved `__FORGE_MISSING__` token in a fixture | generation, exit 1 |
| D2 | `import { Repository } from 'typeorm'` in `libs/core/src/` | `npm run lint` |
| D3 | an assertion removed from a core conformance suite | the backend conformance test |
| D4 | adopt mode against a repo with an existing `CLAUDE.md` | must skip it, bytes identical |
| D5 | `grep -ri voku template/ tools/` | zero hits (G4) |
| D6 | an endpoint added with no decorator | **401 without a token** — proves the global guard |
| D7 | known email + wrong password vs. unknown email | responses indistinguishable |
| D8 | a refresh token presented twice | rejected **and** the family revoked |
| D9 | org A member requests an org B resource | **404/403, never data** — tenant isolation |
| D10 | MFA-enrolled user submits correct credentials | returns a challenge token only, never access tokens |
| D11 | OAuth callback whose email matches an existing password account | must **not** auto-link |
| D12 | a `ResourceGrant` revoked mid-session | next request denied, no stale cache |
| D13 | `UPDATE`/`DELETE` attempted on `audit_entries` by the app role | rejected at the database |
| D14 | `grep -riE "\bjwt\b|cookie|http" libs/core/src` | zero hits — core purity in prose |
| D15 | last `OWNER` of an org tries to leave or demote themselves | rejected |

D6–D15 exist because a platform that compiles and returns 200 on the happy path is not a
platform that is secure; these are the assertions that would actually catch a regression.

CI: unit + integration on every push; Docker e2e on PRs.

## 12. Extraction procedure

Voku is read-only throughout (N1).

1. Copy **by explicit per-file allowlist**, never `cp -r` of a package — structurally excluding
   `node_modules/`, `dist/`, `coverage/`, `.git/`, `.nx/`, `storybook-static/` and any `.env`,
   rather than relying on ignore patterns to catch them.
2. Generalize: strip Voku domain code and naming; replace `@voku/*` and `Voku` with
   `__FORGE_SCOPE__`/`__FORGE_TITLE__`; rewrite the four convention ADRs; rewrite `reviewer`
   for table-driven dimensions.
3. **Build the platform in §9.** Voku's auth is a starting point, not the destination — its
   optional-guest-auth and guest-token paths (ADR-0004) and event-scoped roles are removed, and
   the identity/tenancy/authorization/audit model is new work.
4. **Sanitization gate before the first content commit** — grep the staged template for `sk_`,
   `pk_live`, `SECRET=`, `PASSWORD=`, `BEGIN .* PRIVATE KEY`, and `voku` (case-insensitive).
   All must return zero hits. This is D5, run as a gate rather than only as a test.
5. **Verify the constraint:** `git -C ~/Progetti/Voku status --porcelain` empty and
   `rev-parse HEAD` still `fdfdbde`.

## 13. Changes from v2

1. **OAuth/social login** via an `IOAuthProvider` port, with Google, GitHub and generic OIDC
   adapters that self-register only when configured (§9.3).
2. **Account linking**, enabled by splitting `AuthIdentity` from `User` (ADR-0005) — with
   silent email-match linking structurally refused.
3. **MFA** — TOTP and WebAuthn, a two-phase login with a single-purpose challenge token, and
   hashed single-use recovery codes (§9.3).
4. **Organizations and membership** (§9.4). Roles move off `User` and onto `Membership`,
   because a role is per-tenant. `platformRole` stays separate.
5. **Per-resource permissions** (§9.5) — a three-layer model with `can()` as pure core logic
   shared by both apps (ADR-0006).
6. **Audit logging** (§9.6), append-only by database grant rather than by convention.
7. **Corrected a purity defect in v2:** `AuthTokens`/`JwtPayload` were specified in
   `libs/core`, which the purity rule explicitly forbids ("never reference … transport
   specifics (HTTP, cookies, JWT)"). Core now models `Session`/`AuthenticationOutcome`; token
   format belongs to the backend. D14 enforces this.
8. **Tests D9–D15** added for tenant isolation, MFA, linking, grant revocation, audit
   immutability, core purity and org invariants.

## 14. Deferred

- `forge update` / drift detection (receipt written, tooling not built).
- The items in §9.9.
- Publishing forge to a remote or to npm.
