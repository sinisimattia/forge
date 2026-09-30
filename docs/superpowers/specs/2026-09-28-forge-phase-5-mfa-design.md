# Forge Phase 5 — Multi-Factor Authentication

**Parent spec:** `2026-09-17-forge-template-design.md` §9.3, §9.7, §9.8, §13 (D10).
This document argues from it and does not restate it. Where the two disagree, §16
of this document says so explicitly and gives the reason; nowhere else.

**Status:** design approved 2026-09-28. Implementation plan not yet written.

---

## 1. What this phase ships

A person can enroll a second factor, and from the moment they do, proving their
password is no longer enough to obtain a session.

Concretely: TOTP and WebAuthn as two kinds of `MfaMethod`; a login that becomes
two-phase when any confirmed method exists; a short-lived, single-use challenge
token that can do nothing but complete the second factor; ten hashed, single-use
recovery codes; and a removal rule that will not let a hijacked session strip the
factor it is defeated by.

It owns discriminating test **D10**: *an MFA-enrolled user who submits correct
credentials receives a challenge token only, never access tokens.*

## 2. What it inherits, and what that means

Phase 2 built the frame this drops into, on purpose:

- **`AuthenticationOutcome` is a discriminated union.** Its own TSDoc says why:
  *"a deployment that requires a second factor introduces an outcome that is
  neither success nor failure but 'not yet'."* This phase adds that variant. It
  does not reshape the login flow, and no caller of `authenticate()` changes
  except by being made to handle a new branch — which is a compile error, which
  is the point.
- **`AuthIdentity` is already split from `User`.** MFA hangs off neither: a
  method proves *the person*, not one way of reaching them, so a method enrolled
  by a password account also gates that account's Google sign-in.
- **Audit is already cross-cutting**, at 33 members with every string value pinned
  by a hand-written map.
- **Phase 4 built the single-use-row machinery** — hashed token, purpose fixed at
  mint time, consumption under a pessimistic write lock — in
  `oauth_authorization_requests`. `mfa_challenges` is that machinery again, and
  deliberately so: the second implementation of a known-good shape is cheaper and
  safer than the first implementation of a new one.

## 3. The core domain — `libs/core/src/mfa/`

Framework-agnostic and transport-free, like every domain in this package. The
folders it needs: `entities`, `enums`, `types`, `contracts`, `errors`, `policies`,
`testing`. It has no `entities` for challenges — a challenge is a transport
concern and lives in the backend, by the amended "where a port lives" test
ADR-0008 records.

### 3.1 `MfaMethod` holds no secret material

Modelled directly on `AuthIdentity`, whose TSDoc already argues the rule:

> *Deliberately empty of secret material. […] no serialization of an identity can
> leak one: there is no field for it.*

So `MfaMethod` carries `id`, `userId`, `type`, `label`, `createdAt`,
`confirmedAt`, `lastUsedAt` — and **no TOTP seed, no public key, no signature
counter**. Those live beside the record that stores them, reachable only by the
implementation that verifies with them. A caller that needs to *verify* does not
need to see them.

`confirmedAt` is nullable and load-bearing: an enrolled-but-unconfirmed method is
one whose owner has not yet proven they can use it. **An unconfirmed method never
gates a login** — otherwise a failed enrollment locks a person out of their own
account, which is the single most common way MFA goes wrong in practice.

### 3.2 `MfaMethodType`

```
TOTP | WEBAUTHN
```

Both members exist from the start even where one ships first, for the reason
`AuthProvider` gives verbatim: adding members later means a stored value changing
meaning. Values are the member names, never ordinals.

### 3.3 The contract

`IMfaService` covers: listing a person's methods, beginning and confirming a TOTP
enrollment, beginning and confirming a WebAuthn enrollment, verifying a second
factor against a challenge, removing a method, and regenerating recovery codes.
It returns domain shapes and throws domain errors. It never sees a token.

### 3.4 Errors

`MfaMethodNotFoundError`, `MfaMethodAlreadyConfirmedError`,
`MfaEnrollmentLimitError`, `MfaChallengeNotFoundError`, `MfaChallengeExpiredError`,
`MfaChallengeAlreadyConsumedError`, `MfaVerificationFailedError`,
`RecoveryCodeAlreadyConsumedError`, `MfaReauthenticationRequiredError` — each a
specific `DomainError` subclass, per the house rule.

## 4. The two pure policies

Everything this phase decides that is not I/O is one of these two functions.

### 4.1 `decideAuthenticationStep(confirmedMethods)`

```
ISSUE_SESSION          — no confirmed method exists
REQUIRE_SECOND_FACTOR  — at least one does, and here they are
```

A discriminated union over the two endings, not a boolean. It takes methods and
returns a decision; it knows nothing about tokens, sessions, or requests. **D10
lives on the other side of this function**, and its test is a table of method
sets against expected decisions, written before the login path exists.

### 4.2 `decideMfaRemoval(methods, methodId, proof)`

```
ALLOWED
REAUTHENTICATION_REQUIRED
```

Removing a method that is not the last confirmed one is allowed on an
authenticated session. Removing **the last** one requires a live proof presented
with the request. See §11 for what counts as proof and why.

## 5. Schema

Three tables, in one migration, `1758000005000-Mfa.ts`. It runs as the schema
owner after `AppRoleAndDefaultPrivileges1758000000000`, so the application role
gets its privileges with no `GRANT` in the file — the ordering that
`migration-sql.spec.ts` pins.

### 5.1 `mfa_methods`

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid, indexed `ix_mfa_methods_user_id` | `REFERENCES users (id) ON DELETE CASCADE`, as every table in this schema but one does |
| `type` | text | `TOTP` or `WEBAUTHN`, unconstrained by the database, read fail-closed (§7) |
| `label` | text | what the person called it |
| `totp_secret` | text, null | present iff `type = 'TOTP'` |
| `totp_last_step` | bigint, null | the last accepted time step, for replay refusal (§9) |
| `webauthn_credential_id` | text, null | present iff `type = 'WEBAUTHN'` |
| `webauthn_public_key` | text, null | present iff `type = 'WEBAUTHN'` |
| `webauthn_counter` | bigint, null | present iff `type = 'WEBAUTHN'` |
| `confirmed_at` | timestamptz, null | |
| `last_used_at` | timestamptz, null | |
| `created_at` | timestamptz | |

`CONSTRAINT uq_mfa_methods_webauthn_credential UNIQUE (webauthn_credential_id)` —
named, matching `uq_auth_identities_provider_account`. A credential may be
registered once across the whole deployment.

The nullable per-type columns are the price of one table, and §7.2 says what
refuses to let them fail open.

### 5.2 `mfa_recovery_codes`

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid, indexed, `REFERENCES users (id) ON DELETE CASCADE` | |
| `code_hash` | text | `hashOpaqueToken` (sha256), never the code |
| `consumed_at` | timestamptz, null | |
| `created_at` | timestamptz | |

`CONSTRAINT uq_mfa_recovery_codes_code_hash UNIQUE (code_hash)` — meaningful
precisely because the hash is deterministic; under a salted derivation it would
be a constraint that can never fire, which by this project's own bar is worse
than no constraint at all.

**There is no state column**, and that is a design decision rather than an
omission — see §7.3.

### 5.3 `mfa_challenges`

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid, indexed, `REFERENCES users (id) ON DELETE CASCADE` | |
| `token_hash` | text | `hashOpaqueToken` (sha256), never the token |
| `purpose` | text | `LOGIN` or `WEBAUTHN_ENROLLMENT`, read fail-closed (§7.1) |
| `webauthn_challenge` | text, null | the ceremony nonce, for WebAuthn rounds only |
| `expires_at` | timestamptz | |
| `consumed_at` | timestamptz, null | |
| `created_at` | timestamptz | |

`CONSTRAINT uq_mfa_challenges_token_hash UNIQUE (token_hash)` — named, for the
reason `uq_oauth_authorization_requests_state`'s own TSDoc gives: it makes a
replayed challenge a constraint violation rather than a race two concurrent
requests both win.

`token_hash` and not `token`, matching `refresh_tokens`,
`email_verification_tokens` and `oauth_authorization_requests`: a leak of this
table must not be a set of usable pending authentications.

Expired rows are swept on write, the way Phase 4's are — and the sweep is
asserted by a test that seeds an expired row and watches it go, because Phase 4
shipped a sweep two artifacts claimed and nothing performed.

## 6. Endpoints

Spec §9.7 lists the surface; this phase implements it with one addition marked.

| Method | Route | Auth | Returns |
|---|---|---|---|
| `POST` | `/auth/mfa/verify` | challenge token | a session, or a refusal |
| `GET` | `/mfa/methods` | session | the person's methods, no secrets — *addition, §16.3* |
| `POST` | `/mfa/totp/enroll` | session | `otpauth://` URI, QR SVG, and a method id |
| `POST` | `/mfa/totp/confirm` | session | confirms, and on the first confirmation returns the recovery codes |
| `POST` | `/mfa/webauthn/options` | session or challenge token | ceremony options |
| `POST` | `/mfa/webauthn/verify` | session or challenge token | confirms an enrollment, or completes a login |
| `DELETE` | `/mfa/:id` | session (+ proof if last) | removes a method |
| `POST` | `/mfa/recovery-codes` | session + proof | a fresh batch, invalidating the old one |

`/mfa/webauthn/options` and `/mfa/webauthn/verify` serve both enrollment and login,
which is exactly the shape that produced Phase 4's fail-open. **They do not
dispatch on caller input.** Enrollment is the authenticated call; login is the
challenge-token call; the purpose is fixed by which credential the request
carried, and a request carrying both is refused.

## 7. The three columns the roadmap predicted, and what each became

`phase-roadmap.md` warns that this phase has at least three columns shaped like
`oauth_authorization_requests.purpose` — where anything not matching the one
value the code tests for fell through to issuing a session. Each is answered.

### 7.1 The challenge purpose

Two genuinely reachable values, `LOGIN` and `WEBAUTHN_ENROLLMENT`. Dispatch is
**explicit equality per modelled value with an unconditional refusing
fallthrough** — never a ternary, never a default that proceeds.

The purpose is fixed by the endpoint that minted the row. `POST /auth/login`
mints `LOGIN`; `POST /mfa/webauthn/options` on an authenticated session mints
`WEBAUTHN_ENROLLMENT`. Nothing a caller sends contributes to it, which is the
mechanism Phase 4 verified: `authorizationUrl` is called with exactly
`{state, codeChallenge, redirectUri}`, so the purpose *cannot* be derived from
caller input.

**Storing the purpose is only half the property; the reader must refuse a purpose
it does not model.** The test writes a row with a third value directly into the
table and asserts the refusal — Phase 4's replay, run forward instead of
backward. On a security branch the safe default is refuse, not proceed.

### 7.2 `MfaMethodType`

Same treatment at the record-to-domain mapper, plus one more: **the mapper
refuses a row whose type and material disagree.** A `TOTP` row with a null
`totp_secret` is not a method that merely fails to verify — it is an account
whose login now demands a factor it can never supply, which is a lockout. It
throws at read.

### 7.3 Recovery-code state does not exist

The third predicted column is removed rather than defended. `consumed_at` is a
nullable timestamp: it is null or it is an instant, and there is no third value
for a reader to fail open on. A `state` column holding `ACTIVE`/`USED` would have
needed the §7.1 treatment; a timestamp needs none.

## 8. Two-phase login

### 8.1 The third variant

`AuthenticationOutcome` gains a **variant**, not a bare enum member. The roadmap
is explicit about why this distinction is load-bearing: the union pins `status`
to specific members, so adding `MFA_REQUIRED` to `AuthenticationStatus` alone
leaves `assertNever` still receiving `never`, and the exhaustiveness injection
fails nothing, anywhere.

```ts
| {
    readonly status: AuthenticationStatus.MFA_REQUIRED;
    readonly user: User;
    readonly methods: readonly MfaMethod[];
  }
```

**The challenge token is not in the union**, and `AuthenticationOutcome`'s
existing TSDoc is the authority for that: *"an implementation that also has to
hand a caller something to present later carries that beside this shape and takes
it out before returning; the domain never learns it existed."* The backend mints
the token beside the outcome.

`methods` is returned because the client cannot render the right prompt without
knowing whether to ask for six digits or to call the authenticator — and it is
safe to return, because credentials have already been proven correct and
`MfaMethod` carries no secret.

### 8.2 The flow

1. `POST /auth/login`, correct credentials, at least one confirmed method →
   `MFA_REQUIRED`. The controller mints a challenge token, writes the hashed
   `mfa_challenges` row with purpose `LOGIN`, and returns
   `{ status, methods, challengeToken }`. **No access token. No refresh cookie.
   No `sessions` row.**
2. `POST /auth/mfa/verify` with the challenge token and either
   `{ methodId, code }` or `{ recoveryCode }` → the row is consumed under a
   pessimistic write lock, the proof is verified, the session is issued.

An expired challenge, a consumed challenge, a wrong code, a replayed recovery
code and a purpose the reader does not model are five distinct refusals, and each
is recorded with its own reason. Whoever made the attempt is told only that it
failed.

### 8.3 What D10 asserts

An absence, which takes **three** assertions rather than one:

1. the response body carries no access token;
2. no refresh cookie is set;
3. **the `sessions` table gained no row.**

The first two alone pass a system that creates the session and merely declines to
mention it. The third is the one that would have caught it.

### 8.4 Every path that issues a session consults the policy

Everything above describes `POST /auth/login`, and that is not the only door.

An account may hold a confirmed second factor **and** a linked federated
identity. Signing in through the provider reaches
`decideFederatedSignIn`, which answers `SIGN_IN_EXISTING`, and
`OAuthService.completeSignIn` calls `sessions.begin` — with no second factor
consulted anywhere on that path. The result is a complete bypass of everything
this phase builds, reachable by anyone who can complete an ordinary Google
sign-in for an account whose owner deliberately enrolled a factor to prevent
exactly that.

**A second factor is a property of the account, not of the way its owner
arrived.** So the rule is structural rather than per-endpoint: every path that
reaches `sessions.begin` calls `decideAuthenticationStep` first, and refuses on
`REQUIRE_SECOND_FACTOR` by minting a `LOGIN` challenge, whichever path it is.
Today that is two paths — password and federated. A third added later inherits
the requirement by being unable to reach session issuance without passing
through the same decision.

This needs saying because `SIGN_IN_EXISTING` *reads* like a completed
authentication. It is not: it is an answer to "which account is this?", which is
a different question from "may this account have a session now?" — and Phase 4
wrote that distinction down in `decideFederatedSignIn`'s own TSDoc, which notes
that whether the named account may actually be used is decided by the caller,
not by that function. MFA is a second instance of the same rule, and the first
one to have a bypass on the other side of getting it wrong.

## 9. TOTP

`otplib` for verification, with a ±1 step window and a 30-second period.

**The implementation is pinned against RFC 6238's published test vectors.** This
is not ceremony. A hand-rolled TOTP verified by a test that recomputes the same
HMAC is Phase 3's tautology rule exactly — the driver's expectation and the
implementation's answer drawn from one source — and it passes while proving
nothing. The RFC's vectors are an independent source that existed before this
code, which is the only thing that makes the assertion mean anything.

A replayed code within its own window is refused: the last accepted step is
recorded per method, and a step not strictly greater than it fails.

Enrollment returns an `otpauth://` URI and a QR rendered **server-side as an SVG**
(§14), so the webapp ships no client-side crypto and no QR library.

## 10. WebAuthn

`@simplewebauthn/server` on the backend, `@simplewebauthn/browser` in the webapp.

Relying-party ID and expected origin are required configuration. **The backend
refuses to boot** with WebAuthn enabled and either absent — the same fail-closed
shape as `buildOAuthProviders`, which refuses the development adapter in
production and refuses a dev-and-real-OIDC pair. A misconfigured RP ID does not
produce a subtly weaker ceremony; it produces one that cannot be completed, and
finding that out at boot is cheaper than finding it out per user.

The ceremony nonce lives on an `mfa_challenges` row rather than in a second
mechanism, so it inherits the single-use write lock rather than reimplementing
it.

**An honest limit, recorded here rather than discovered later:** assertion
verification is `@simplewebauthn/server`'s, not this template's, and the browser
half is reachable in tests only through mocks. The verifiable security value of
this phase concentrates in the challenge-token property — which is
method-agnostic, and therefore covers WebAuthn as fully as it covers TOTP.

## 11. Recovery codes, and removing the last method

### 11.1 Recovery codes

Ten, generated at the **first** method confirmation, displayed exactly once, and
stored through `common/crypto/hashOpaqueToken` — sha256, the same derivation
`refresh_tokens`, `email_verification_tokens` and `password_reset_tokens` already
use. Single-use via `consumed_at`. `POST /mfa/recovery-codes` issues a fresh
batch and invalidates every code in the previous one.

**Not argon2, and the distinction is the whole reason both exist in this tree.**
Argon2's work factor defends a secret a person chose, where the search space is
small enough that an attacker can walk it. A recovery code is 128 bits from
`randomBytes` — nothing is walking that, so the work factor buys no security and
costs three things it cannot repay: a salted derivation is not lookupable, so
verification degrades to argon2-verifying every unconsumed code a user holds; ten
argon2 verifications per attempt on an unauthenticated-adjacent endpoint is a
self-inflicted denial of service; and the unique constraint above becomes one
that can never fire. `hashOpaqueToken` is the existing answer for exactly this
class of credential and this is exactly that class.

A recovery code is presented at `/auth/mfa/verify` **through its own explicit
field**, never sniffed out of the code field by length or shape. Phase 4's Task 6
defect was precisely a shapeless string that a format-only check would also have
passed; a discriminator that is a field name cannot be fooled by a well-chosen
input.

### 11.2 Removal

Removing a method that is not the last confirmed one requires only the session.

Removing the last one requires **re-proving the second factor** — a live code
from any confirmed method, or an unused recovery code. Two reasons, and §16.1
records this as a departure from the parent spec's wording:

- An OAuth-only account has no password to re-present, so a password rule has a
  shape it cannot serve for a population this template explicitly supports.
- The threat is a session that has already been hijacked being used to strip the
  factor that defeats the attacker. Only the second factor stops that; a password
  the attacker likely phished does not.

`POST /mfa/recovery-codes` carries the same requirement, for the same reason: a
fresh batch invalidates the codes the rightful owner is holding.

## 12. The webapp

- **`pages/mfa/challenge.vue`** — new. The second phase: prompts for a TOTP code,
  offers the authenticator for a WebAuthn method, and offers a recovery code as
  the way out. Renders each of the five refusals with its own message and remedy.
- **`pages/account/security.vue`** — rebuilt to list methods, enroll, remove, and
  regenerate recovery codes.
- The auth store learns the `MFA_REQUIRED` status and holds the challenge token
  in memory only — never in a cookie, never in the SSR payload, which is the
  property Phase 3 spent a task establishing for the access credential.
- Stories for every new component, and `en` locale strings.

**The meeting point is asserted.** Phase 4 shipped a callback page that rendered
all seven refusal messages correctly while `landingUrl` sent the browser
somewhere else entirely, so the message behind that phase's central security
property was displayed nowhere — invisible because the page's spec asserted the
page, the controller's spec asserted the redirect, and nothing asserted they met.
This phase asserts that a login answering `MFA_REQUIRED` routes to
`/mfa/challenge`, as its own test, in addition to the two halves.

## 13. Audit

Eight new members, taking `AuditAction` from 33 to **41**:

`MFA_METHOD_ADDED`, `MFA_METHOD_REMOVED`, `MFA_CHALLENGE_ISSUED`,
`MFA_CHALLENGE_SUCCEEDED`, `MFA_CHALLENGE_FAILED`, `RECOVERY_CODES_REGENERATED`,
`RECOVERY_CODE_CONSUMED`, `FEDERATED_AUTHORIZATION_CORRUPT`.

This section first named six. `MFA_CHALLENGE_ISSUED` and
`FEDERATED_AUTHORIZATION_CORRUPT` were added while building and are kept, because
each satisfies the rule that decides whether a member is owed at all: **an ending
of a path is a fact about the system that no other member would record.** A
challenge handed out with nothing yet proven is one — a federated sign-in reaches
that point having presented no local credential, so without it the issuance is
silence. A stored authorization row found in a state this application never
writes is the other. Anyone extending this enum should apply that rule rather
than reading this list as the set.

**Every one is added to the hand-written pinning map**, and a failure there is the
guard working rather than an obstacle. The map is transcribed rather than derived
on purpose: a derived expectation cannot fail for the reason the map exists. The
compiler catches a rename; nothing but this catches a changed string *value*, and
an append-only table written with a value that disagrees with every row already
in it is not recoverable.

`MFA_CHALLENGE_FAILED` records the reason, which whoever made the attempt is
never told.

## 14. Dependencies

Four, all in `template/`. **Forge's own generator remains at zero dependencies**
(ADR-0002); nothing in this phase touches `tools/create/`.

| Package | Where | Why |
|---|---|---|
| `otplib` | backend | TOTP. Named by parent spec §8.3's core import ban, so anticipated. |
| `@simplewebauthn/server` | backend | WebAuthn ceremonies. Likewise named. |
| `@simplewebauthn/browser` | webapp | The `navigator.credentials` call. Likewise named. |
| `qrcode` | backend | Renders the enrollment QR as an SVG server-side. **This one is an addition of this phase** (§16.2). |

All four are added to `libs/core/eslint.config.mjs`'s `no-restricted-imports`
where they are not already there, so core purity stays structural rather than
reviewed.

## 15. Testing and gates

Every claim below is a thing that must be **observed to fail** when its fault is
injected. A green suite is not evidence.

- **D10** as a discriminating test, asserting the three absences of §8.3.
- **RFC 6238 vectors** for TOTP (§9).
- **The purpose replay:** a row written directly with an unmodelled purpose, and
  the refusal it must produce (§7.1).
- **The type/material disagreement:** a `TOTP` row with a null secret, and the
  throw at read (§7.2).
- **The meeting point:** login answering `MFA_REQUIRED` routes to
  `/mfa/challenge` (§12).
- **The sweep:** an expired challenge row seeded, and watched to go (§5.3).
- **`/mfa/challenge` joins the `FORGE_E2E` dev-webapp walk** beside `/` and
  `/login`. Nothing in this repository made an HTTP request against the dev
  webapp until Phase 4, and every page of it had returned 500 since Phase 2. A
  new page in the authentication path goes into that walk.
- **The Docker e2e** enrols TOTP against real Postgres and logs in through the
  challenge, asserting the `sessions` count across both phases.
- **The slow tiers run at Task 3**, not at the end. Phase 4 measured the cost of
  deferring them: two unrelated on-the-merits failures surfaced before a single
  assertion of the new work got to run.

**Task 1 is not MFA.** Three backend specs — `d9-tenant-isolation.spec.ts`,
`change-password.spec.ts`, `members.controller.spec.ts` — flake as spurious 401s,
one pattern with three faces, pointing at shared session state across parallel
jest workers. `d9-tenant-isolation.spec.ts` is a discriminating security test, and
a flaky security test's greenness is not evidence. It is investigated under an
explicit run cap before any MFA code exists, because this is a phase about
whether sessions get issued and the suite judging it has to mean something first.

**Triage drains where the work goes.** Any of the 41 deferred minor items living
in a file a Phase 5 task already opens is fixed in that task rather than
re-ledgered. Items in untouched files stay on the list.

## 16. Departures from the parent spec

Three, each deliberate.

### 16.1 What "re-authentication" means for removal

§9.3 says *"Removing the last MFA method requires re-authentication"* without
saying re-authentication of what. This phase rules it means re-proving the
**second factor**, not the password. §11.2 gives the two reasons: an OAuth-only
account has no password to present, and the threat model is a hijacked session,
which a password does not defend against.

### 16.2 `qrcode` is a fourth dependency

§8.3 anticipates `otplib` and `@simplewebauthn/*`. `qrcode` is added so the
enrollment QR renders server-side as an SVG. The alternative — showing the
`otpauth://` URI and the base32 secret for manual entry — is functional and one
dependency lighter, and was considered and declined: every authenticator accepts
manual entry, but a template whose enrollment screen asks a person to type a
base32 secret is a template whose first change in every project is this screen.

### 16.3 `GET /mfa/methods` is added to the surface

§9.7's MFA row lists seven endpoints and none of them reads the enrolled methods.
The account security screen cannot render without that, and inferring it from a
login response would mean re-authenticating to see a list. It returns methods
only, which carry no secret material by construction (§3.1).

## 17. Non-goals

- **Organization-enforced MFA.** No policy making a second factor mandatory for
  members of an organization. §9.3 makes enrollment a property of a person, and
  the enforcement question is a tenancy feature with its own escape hatches
  (break-glass, grace periods, exempt service accounts). YAGNI.
- **SMS or email as a factor.** Neither is a second factor in any meaningful
  sense, and shipping one in a template teaches the wrong thing.
- **Trusted devices / "remember this browser".** A real feature with real
  storage, expiry and revocation questions. Not this phase.
- **The verified-email challenge for linking.** Unbuilt, permitted by §9.3 as an
  alternative to the authenticated session, and **not MFA's** — it must not be
  folded in silently. `phase-4-decision-log.md` §7 records what building it costs.
- **Migrating existing accounts.** There are none: `mfa_methods` starts empty in
  every generated project, and no existing row in any table is altered.

## 18. Task sequence

Roughly eighteen tasks, in this order. The plan will right-size them.

1. The flaky-401 investigation, under its run cap. No MFA code.
2. The core domain: `MfaMethod`, `MfaMethodType`, types, errors.
3. The two pure policies, with their tables of cases — **and the slow tiers run
   here**, early, against a tree that has barely changed.
4. `AuthenticationOutcome`'s third variant, and every `switch` it breaks.
5. The migration and the three record entities.
6. The challenge row: minting, hashing, the write-locked consumption, the sweep,
   and the purpose refusal.
7. TOTP verification against the RFC vectors.
8. TOTP enrollment and confirmation, with the QR.
9. Two-phase login, and D10.
10. Recovery codes: generation, hashing, single-use consumption.
11. Removal and re-authentication.
12. WebAuthn configuration and the boot refusal.
13. WebAuthn enrollment.
14. WebAuthn login.
15. The six audit members and the pinning map.
16. The webapp: the challenge page, the store status, the meeting-point assertion.
17. The webapp: the security screen, enrollment, removal, recovery codes, stories.
18. The gates: the e2e walk, the Docker TOTP login, the sanitize run, the docs.

---

**The one sentence to carry into the plan.** Phase 4's signature defect was a
check that could not fail reading as evidence; its most valuable act was ruling a
Minor up and running it. This phase has more refusal endings than that one, and
every one of them is a place where a branch that cannot fail would look exactly
like a branch that works.
