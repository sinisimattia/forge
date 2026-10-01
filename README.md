<p align="center">
  <img src="forge-logo.png" alt="Forge" width="320">
</p>

<p align="center">
  <strong>Stop building the same backend. Generate it, once, with the identity platform already finished.</strong>
</p>

<p align="center">
  One template. One command. A bootable NX monorepo with auth, tenancy, MFA and an append-only audit log — and the gates that keep them honest.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-22-5FA04E?logo=node.js&logoColor=white" alt="Node 22">
  <img src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white" alt="NestJS 11">
  <img src="https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&logoColor=white" alt="Nuxt 4">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16">
  <img src="https://img.shields.io/badge/generator%20dependencies-0-success" alt="Zero dependencies">
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-whats-in-the-box">What's in the box</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-adopt-mode">Adopt mode</a> ·
  <a href="#-the-gates">The gates</a> ·
  <a href="#-known-limitations">Limitations</a>
</p>

---

Most templates hand you a skeleton and a `TODO`. Forge hands you the part everyone rewrites
badly: sign-up, sign-in, sessions that rotate, organizations, roles, per-record grants,
federated providers, a second factor, rate limiting, and an audit log the application role
cannot edit. It ships as **one** complete monorepo you copy and rename — no presets, no stack
variants, no layer composition — and the generator that copies it has **zero runtime
dependencies**.

What it does not ship is a product. That part is yours.

<table>
<tr>
<td width="33%" valign="top">

### 🔐 Auth, finished
Password and federated sign-in, email verification, recovery, rotating refresh tokens, TOTP
and passkeys, single-use recovery codes.

</td>
<td width="33%" valign="top">

### 🏢 Tenancy and access
Organizations, memberships, invitations, roles and per-record grants — answered by one pure
function, never an ambient lookup.

</td>
<td width="33%" valign="top">

### 📜 Audit you can trust
Append-only at the database. The application connects as a role with no `UPDATE` or `DELETE`
on the table, and cannot grant them back.

</td>
</tr>
<tr>
<td valign="top">

### 🧱 A domain that knows nothing
`libs/core` imports no framework and names none — not in code, not in prose. A gate reads the
comments too.

</td>
<td valign="top">

### 🚦 Abuse resistance
Every credential and second-factor surface is budgeted, keyed only on subjects the server
minted. Counters live in Postgres, so replicas share them.

</td>
<td valign="top">

### 🤖 The "how we work" layer
An agent roster, single-source standards, and the ADRs that say why — adoptable into a
repository you already have.

</td>
</tr>
</table>

---

## 🚀 Quick start

```bash
npm run create -- --name my-app
cd my-app
npm run dev:up
```

That's a running stack — backend, webapp and Postgres, containerized on Node 22 — with a
database-backed readiness probe and a webapp you can sign up to.

> [!NOTE]
> Generation stages the project in a sibling directory and only then moves it into place, so a
> failed run leaves nothing behind. The staging directory is a sibling rather than the OS temp
> directory on purpose: `fs.rename` across filesystems fails with `EXDEV`, and the final move
> has to be a real atomic rename.

<details>
<summary><strong>Every flag</strong></summary>

```bash
npm run create -- --name my-app \
  --title "My App" \
  --scope @my-app \
  --description "An app." \
  --db-name my_app \
  --out ~/projects \
  --no-git \
  --yes
```

| Flag | Default |
|---|---|
| `--out` | the current directory; the project lands at `<out>/<name>` |
| `--no-git` | off — `git init` and an initial commit run by default |
| `--yes` | off — accepts every derived default and skips prompts |

`dev:up` installs inside the containers from the committed `package-lock.json`. A host
`npm install` is optional, and only useful for editor tooling.

</details>

---

## 📦 What's in the box

A generated project is a working identity platform, not a scaffold. Six phases are built.

| | Ships |
|---|---|
| **Identity** | users, auth identities, sessions with rotating refresh tokens, email verification, password reset |
| **Tenancy** | organizations, memberships, invitations that are single-use, expiring, hashed and address-checked |
| **Authorization** | platform roles, organization roles, per-record grants — all through one `can()` in core |
| **Federated sign-in** | Google, GitHub and generic OIDC behind one port, PKCE, and a development adapter that refuses to exist in production |
| **Second factor** | TOTP, WebAuthn passkeys, single-use recovery codes, and a compiler-held guarantee that no session opens without one |
| **Hardening** | throttling on every credential surface, continuity of control on enrolment, append-only audit |

> [!IMPORTANT]
> A second factor belongs to the **account**, not to the way in. The federated callback asks
> for it too. That decision is [ADR-0012](template/docs/adrs/0012-a-second-factor-is-a-property-of-the-account.md),
> and it is the kind of thing that is a migration rather than an edit if you get it wrong later.

**Not included, deliberately:** nested teams inside organizations, SAML/SCIM provisioning, API
keys and machine-to-machine tokens, per-field permissions, and self-service billing.

---

## 🏗 Architecture

```mermaid
flowchart LR
  B[Browser] --> W[Nuxt webapp]
  W -->|"REST, bearer + refresh cookie"| G

  subgraph G[NestJS guard chain]
    direction TB
    G1[JwtAuthGuard<br/><i>closes every route</i>] --> G2[ForgeThrottlerGuard<br/><i>budgets the attempt</i>] --> G3[PermissionsGuard<br/><i>asks can()</i>]
  end

  G --> S[Services]
  S --> C["libs/core<br/><i>pure policy, no framework</i>"]
  S --> DB[(PostgreSQL)]
  S -.->|append only| A[(audit_entries)]

  style C fill:#1f6feb,color:#fff
  style A fill:#8250df,color:#fff
```

Three packages, one rule each:

- **`libs/core`** — the domain, framework-agnostic and transport-free. One folder per domain, plus `shared`. Service ports ship **executable conformance suites**, and the backend runs every
  one against its real implementation — so "the adapter satisfies the contract" is a test, not
  a review note.
- **`apps/backend`** — NestJS, TypeORM, seven migrations. External capabilities are ports with
  development adapters, so a fresh clone works end to end with nothing to sign up for
  ([ADR-0008](template/docs/adrs/0008-ports-not-vendors.md)).
- **`apps/webapp`** — Nuxt 4 over an Atomic Design component library, with the layering
  enforced by a checker rather than a convention.

<details>
<summary><strong>The layout a generated project gets</strong></summary>

```
my-app/
├── CLAUDE.md, README.md, forge.json          # forge.json is the extraction receipt
├── compose.yaml, compose.prod.yaml, .env.example
├── .github/workflows/ci.yml
├── .claude/agents/, .claude/agent-memory/
├── docs/{standards,adrs,rfcs,architecture,guides,concepts,api,superpowers}/
├── libs/core/        → users identities auth mfa organizations authorization audit shared
│                       grouped by kind: entities/ types/ enums/ errors/ policies/, plus
│                       contracts/ + testing/ where a domain has a service port
└── apps/
    ├── backend/      → auth, identities, users, mfa, organizations, authorization,
    │                   audit, throttling, mail, health, common, db/migrations
    └── webapp/       → auth + account + organizations + mfa pages, Atomic Design library,
                        stores, composables, fetchers, Storybook + Vitest
```

</details>

---

## 🔁 Adopt mode

To bring only the "how we work" layer into a repository that already exists:

```bash
npm run create -- --into ~/existing-repo
```

It copies the declared process subset — `CLAUDE.md`, the agents, the shared standards, and the
ADRs about process — and **never overwrites an existing file**. Anything already there is
skipped and listed in the closing report.

> [!WARNING]
> The adopted agent prompts point at `libs/core/STANDARDS.md`, `apps/backend/STANDARDS.md` and
> `apps/webapp/STANDARDS.md` for their review dimensions, and those files are **not** in the
> subset. In a repository without them, `reviewer` discovers zero dimensions and reports every
> package clean — not because the code is clean, but because it found nothing to check against.
> Write equivalents at those paths, or expect that guidance to be inert. The closing report
> names them after every run.

---

## 🛠 Changing the template

`template/` is an ordinary, complete, bootable monorepo — **not** a set of `.hbs` files. Edit
it directly:

```bash
cd template && npm install
```

and treat it like any other project while you work. The tokens are the only thing that makes
it a template, and they are valid TypeScript identifiers and valid JSON strings, so nothing
breaks while you have it open.

> [!IMPORTANT]
> `npm run sanitize` must pass before any commit that touches `template/`. It is what catches
> a source-project trace or a populated secret before it ships into every project generated
> afterwards. Run it; don't weaken it to make a commit pass.

---

## 🧪 The gates

A gate that only ever runs against correct code proves nothing. The spec's §11 lists sixteen
faults, **D1–D16**, each with the observation that must catch it — and the ones Forge owns are
enforced by *injecting the fault and watching the gate fail*.

| | Fault injected | Caught by |
|---|---|---|
| **D1** | an unresolved `__FORGE_MISSING__` token | generation aborts, leaving nothing behind |
| **D2** | `import { Repository } from 'typeorm'` in a real core entity — static, dynamic and `require()` | `nx lint core`, each form's own rule message asserted |
| **D4** | adopt mode over a repo that already has `CLAUDE.md` | the file stays byte-identical and is reported as skipped |
| **D5** | a source-project trace or a populated secret | `npm run sanitize` |
| **D14** | a TSDoc line naming a JWT and a cookie in a real core contract | `npm run purity -w libs/core`, both terms asserted |

D2 and D14 are injected into files that were already there and restored afterwards — a probe
file a test writes for itself only ever proves the guard covers the directory the probe went
into. The rest are behaviours of the generated application and live in its own suites.

```bash
npm run test:all     # sanitize → unit → integration (generates a real project, runs its gates)
```

> [!TIP]
> `npm test` is the **unit tier only**, and `FORGE_E2E=1 npm test` runs nothing extra. The slow
> tiers live in `npm run test:integration`; `FORGE_E2E=1` adds the Docker stage on top. Budget
> real time for it — a generated project's `npm ci` plus a Nuxt build, then image builds.

Two gates are not in any `run-many` list and need naming explicitly, in Forge and in every
generated project:

```bash
npm run purity -w libs/core     # core names no framework or transport, in code or in prose
npm run layers -w apps/webapp   # a component renders only layers below its own
```

<details>
<summary><strong>CI, and why the slow jobs run on push</strong></summary>

| Job | Runs | Does |
|---|---|---|
| `unit` | push + PR | `sanitize`, then the generator's unit tests |
| `generated-project` | push + PR | generates a real project and runs its own gates |
| `storybook` | push + PR | the only thing that compiles the story files at all |
| `docker` | push + PR | boots the generated stack for real |
| `lockfile-refresh` | weekly | regenerates the lockfile and re-runs the gate; never commits |

`generated-project` and `docker` used to be pull-request-only, which meant a direct push to
`main` ran `unit` and nothing else — everything a PR checked could be landed by pushing. A push
now costs 30–45 minutes instead of 10. **A gate that runs only on the path somebody can choose
not to take is not a gate.**

Forge itself has no dependencies and therefore no lockfile, so no `npm ci` step appears in its
own workflow. There is nothing to install.

</details>

---

## 🔤 Tokens

Substituted in file contents **and** path segments, so `"name": "__FORGE_SCOPE__/core"`
generalizes correctly. Generation fails if any `__FORGE_[A-Z0-9_]*__` token survives.

| Token | Example | Source |
|---|---|---|
| `__FORGE_NAME__` | `my-app` | prompted; `^[a-z][a-z0-9-]*$` |
| `__FORGE_TITLE__` | `My App` | derived — title-cased |
| `__FORGE_SCOPE__` | `@my-app` | derived — `@` + name |
| `__FORGE_DESCRIPTION__` | `An app.` | prompted, may be empty |
| `__FORGE_DB_NAME__` | `my_app` | derived — `-` → `_`; `^[a-z][a-z0-9_]*$` |

Binary files are detected by a NUL byte in the first 8 KiB and copied verbatim.

---

## ⚠️ Known limitations

- **No drift or update tooling.** `forge.json` records the commit a project was generated
  from, so re-syncing stays *possible*, but nothing does it yet.
- **A generated project's CI workflow is never parsed.** It is copied like any other file and
  checked only by a plain-text scan, so a YAML error in it would ship silently. Validating it
  needs a YAML parser, which conflicts with the zero-dependency constraint — accepted as a
  known gap, not an oversight.
- **No OpenAPI document.** The webapp's service layer is written by hand against a contract
  that exists only as backend source.
- **Recovery codes predating the transcribable alphabet no longer redeem**, and there is no
  administrator reset path. Nothing is deployed yet, which is why no transition was built.

---

## 📚 More

| | |
|---|---|
| Design spec | [`docs/superpowers/specs/2026-09-17-forge-template-design.md`](docs/superpowers/specs/2026-09-17-forge-template-design.md) |
| Phase roadmap | [`docs/superpowers/phase-roadmap.md`](docs/superpowers/phase-roadmap.md) |
| Forge's own ADRs | [`docs/adrs/`](docs/adrs/) — one template not layers, a dependency-free generator, copy-out-only extraction |
| The template's ADRs | [`template/docs/adrs/`](template/docs/adrs/) — the decisions a generated project inherits |
| Agent orientation | [`CLAUDE.md`](CLAUDE.md) |

---

<p align="center">
  <sub>Forge was extracted once, read-only, from a real monorepo — and never reads from it again.</sub>
</p>
