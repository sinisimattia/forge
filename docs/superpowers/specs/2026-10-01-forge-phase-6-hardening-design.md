# Forge Phase 6 — Hardening and Abuse Resistance

- **Date:** 2026-10-01
- **Status:** Draft for review
- **Phase:** 6 of the roadmap in `docs/superpowers/phase-roadmap.md`
- **Inherits:** `docs/superpowers/phase-5-decision-log.md` §8

## 1. What this phase is for

Spec §9's identity, tenancy and access platform is feature-complete. Phases 2 through 5
built what the application can do. This phase does not add capability: it makes what exists
survive an attacker and an operator.

Three strands, in priority order:

1. **Throttling.** Nothing anywhere limits how often a credential or a second factor may be
   attempted. A six-digit code with unlimited attempts is a six-digit code.
2. **Continuity of control.** Enrolling a second factor costs nothing but a live session, so
   a stolen session can enrol its own factor and then delete the owner's.
3. **Conformance to ADR-0013**, newly recorded, and the cheap carried debt from §8.

### Non-goals

- No new product capability. Nothing in §9.9 ("still not included") is started here.
- No network-keyed limiting, and no trusted-proxy configuration. §4.2 states why.
- The open investigations in §8 — the unreproduced 401 trio, the Storybook development
  crash, the real-Postgres confirm walk — are **not** in this phase. They have no bounded
  deliverable, and the 401s have already consumed three capped investigation budgets.
- The concurrent double-enroll `409` is **not** in this phase. Correctness already holds;
  the unique index refuses the duplicate. It is an error-shape fix that moves a transaction
  boundary, and it stays carried.

## 2. Global constraints

Every task in this phase inherits these. They are copied verbatim into each task brief.

- **`~/Progetti/Voku` is read-only.** Never write to it; never run a command there that could
  change tracked or untracked state. Before and after any task, confirm
  `git -C ~/Progetti/Voku status --porcelain` is empty and `git -C ~/Progetti/Voku rev-parse
  HEAD` is unchanged. Those two read-only commands are required, not forbidden.
- **The generator takes no dependencies.** `tools/create/` and `tests/` use Node builtins
  only; the root `package.json` has no `dependencies` and no `devDependencies`. This phase
  adds packages to `apps/backend` only, which is a different package.json and is allowed.
- **`npm run sanitize` must pass before any commit touching `template/`.** Never weaken a
  rule to make a commit pass; `tools/sanitize.mjs` stays byte-identical.
- **Never add a foreign key to `audit_entries`**, in either direction. A referential action
  runs with the table owner's privileges and voids ADR-0009.
- **`libs/core` stays framework-agnostic and transport-free, in prose as well as imports.**
  `grep -riE "\bjwt\b|cookie|http" template/libs/core/src` returns nothing. Its K1/K2 review
  dimensions apply to everything this phase adds there.
- **ADR-0013 governs every mechanism choice.** Use the framework's own component; adapt it
  at its published extension point; record any departure beside the code with what the
  framework's answer is and what it fails to do here.
- **State the invariant, not the enumeration.** Phase 5's signature defect: a comment that
  counts ("both callers", "the only place", "eight call sites") is true when written and rots
  silently. Correcting a count resets the clock; stating the invariant survives.
- **Docker headroom** is measured with `docker run --rm alpine df -h /`, never
  `docker system df`. Never stop, remove or reconfigure a container this work did not create.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## 3. ADR-0013 conformance — the audit, and what it found

ADR-0013 ("The Framework's Own Answer, First") was recorded as part of this phase. The
existing code was audited against it. Most of it conforms already: authentication is
`@nestjs/passport` and `@nestjs/jwt`, configuration is `@nestjs/config`, persistence is
`@nestjs/typeorm`, translation is `nestjs-i18n`, validation is `class-validator`; the webapp
uses the framework's own routing middleware, plugins, runtime configuration and page
metadata, with `@pinia/nuxt`, `@nuxtjs/i18n`, `@nuxtjs/tailwindcss` and `@nuxtjs/storybook`.

`ParseUuidParamPipe` is the pattern ADR-0013 names: the framework's own parameter pipe,
constructed with an `exceptionFactory` so a malformed parameter raises this application's
translation key. Nothing about it is hand-rolled, and the one part that had to answer to a
local contract is the only part supplied locally.

Three findings. Each is a task in this phase.

### 3.1 The liveness endpoint reports healthy when the database is down

`apps/backend/src/health/health.controller.ts` returns `{ status: 'ok' }` unconditionally.
It is the endpoint both compose files' container healthchecks poll and the one the e2e smoke
test waits on. Because it consults nothing, a backend whose database connection is gone
reports healthy for ever, `service_healthy` is satisfied, and dependent containers start
against a backend that answers every real request with a `500`.

The framework ships `@nestjs/terminus` for exactly this, with a database indicator that
issues a real check through the existing connection. Adopting it makes readiness mean
something, and it is strictly less code than the hand-rolled controller plus the test that
would otherwise have to assert the new behaviour by hand.

Liveness and readiness are separated, because they answer different questions and a
container that restarts itself whenever its database blips is worse than one that reports
unready. Liveness stays dependency-free; readiness checks the database. The compose
healthchecks move to readiness; neither endpoint stops being `@Public()`, and the reason
recorded in the existing controller's documentation — that a `401` resolves, so `r.ok` is
false and nothing ever starts — is preserved, because it is still true and still the thing
somebody will otherwise rediscover the hard way.

### 3.2 A departure justified by a claim that is not true

`apps/webapp/app/fetchers/client.ts` uses the platform's `fetch` rather than the framework's,
and states the reason as `credentials`: "the renewal cookie only travels when the request
asks for it, that is a `fetch` option".

That is not a reason. The framework's fetch options type extends `Omit<RequestInit, "body">`,
so `credentials` is accepted and forwarded like any other request option. Verified against
`ofetch@1.5.1`.

This is the defect Phase 3 named and Phase 5 refined, in its most expensive form: not a
comment that drifted out of true, but a justification that was never true, resting on a
property of a dependency nobody checked. It reads as having been considered.

There may be sound reasons to keep the platform's `fetch` here — the framework's wrapper
throws on a non-2xx response and parses the body on the way, and this client's whole job is
to inspect a `401` and decide whether to renew, which is the one case where being handed an
exception instead of a response is a cost rather than a convenience. **That is a different
argument, and it has to be made on its merits.** The task is: establish which is true by
reading the dependency, then either adopt the framework's fetch or replace the justification
with the real one. Not both, and not neither.

### 3.3 No API description is generated

The backend produces no OpenAPI document, and the webapp's service layer is written by hand
against a contract that exists only as backend source. The framework ships `@nestjs/swagger`,
which derives the document from the validation decorators already on every DTO.

Nothing is currently duplicated, so this is a recommendation rather than a defect, and it is
**deferred out of this phase** — it would add a surface to every controller in the workspace,
which is a poor companion to a phase whose other changes are security-bearing and want a
small diff. Recorded in the roadmap as Phase 7's inheritance.

## 4. Throttling

### 4.1 Mechanism

`@nestjs/throttler` (first-party; its peer range includes the `@nestjs/*` major this backend
runs). Per ADR-0013 it is adopted, not reimplemented, with three adaptations at its own
extension points:

| Adaptation | Extension point | Why |
|---|---|---|
| The key is a server-known subject | `getTracker` | §4.2 |
| Refusal raises the domain error | `throwThrottlingException` | §4.4 |
| Counters are shared across processes | `storage` | §4.5 |

`libs/core` gains nothing from this. The algorithm belongs to the library and the limits are
configuration; there is no pure decision left to state in core, and inventing one for
symmetry would be cargo cult. The one core addition this phase makes is §5's policy, which
is a domain rule and would exist with or without a throttle.

### 4.2 What a throttle counts against

**Only subjects the server minted or the attack targets. Never the network address.**

`apps/backend/src/auth/client-context.ts` records that the address and the user-agent label
are "recorded and neither is ever trusted for a decision", and nothing configures a trusted
proxy. Behind a reverse proxy — which is how `compose.prod.yaml` expects to be deployed —
the observed address is the proxy's, identical for every user, so a per-address limiter would
meter the entire userbase as one bucket. Configuring the proxy as trusted makes the address
client-supplied, which both defeats the limiter and turns it into a way to deny service to
somebody else's account.

**This phase does not close the spray case.** An attacker distributing a few attempts across
many accounts from one host is not limited by anything here. That is stated rather than
half-covered, because a limiter that appears to cover it and does not is worse than its
absence. Closing it needs a trusted-proxy layer, which is Phase 7's to weigh.

### 4.3 The buckets

**The decorators are the authority, not this table.** Which bucket a route draws on is the
`@Throttled(...)` on it in `auth.controller.ts` and `mfa.controller.ts`; what each bucket
counts against is `BUCKET_SUBJECT` in `throttling.config.ts`; what each one allows is
`buildBuckets` beside it. A table restated here can fall behind all three, and has. Read it
as a map, and settle any disagreement against those files.

| Name | Subject | Routes | Default limit |
|---|---|---|---|
| `mfa-attempt` | `ACCOUNT_OR_CHALLENGE` — the signed-in account, else the challenge presented, else a digest of the bearer | `POST /auth/mfa/verify`, `POST /mfa/webauthn/verify` | 5, over the challenge's own lifetime |
| `mfa-mint` | `ACCOUNT_OR_CHALLENGE` | `POST /auth/mfa/methods`, `POST /mfa/totp/enroll`, `POST /mfa/webauthn/options` | 10 / 15 min |
| `mfa-proof` | `ACCOUNT_OR_CHALLENGE` | `POST /mfa/totp/confirm`, `POST /mfa/recovery-codes`, `DELETE /mfa/:id` | 10 / 15 min |
| `credential` | `ADDRESS` — the submitted email, normalized | `POST /auth/login`, `POST /auth/forgot-password`, `POST /auth/resend-verification` | 10 / 15 min |
| `reset-credential` | `RESET_CREDENTIAL` — the single-use credential presented | `POST /auth/reset-password` | 10 / 15 min |

`reset-credential` is its own bucket rather than a share of `credential`, because a reset
request carries no address to count against; it reads the same two environment variables for
its limit and window, so the two move together unless somebody splits them.

**What actually bounds a six-digit grind is `credential`, not `mfa-attempt`.** A `LOGIN`
challenge is consumed *before* the proof offered against it is checked:
`MfaVerificationService.completeLogin` and `completeLoginWithRecoveryCode` each call
`spendChallenge` on their first line, and `WebAuthnCeremonies.loginOptions` consumes before
it does anything else. **One challenge therefore admits exactly one guess.**

`mfa-attempt`'s five is not unreachable — `d16-throttle-refusal.spec.ts` reaches it by
presenting the same token six times and gets its `429` — but the four attempts after the
first are refused as *already consumed*, without the code on them ever being looked at. They
are not guesses, and nobody grinding a code would spend them; the budget is real and it
bounds nothing an attacker would do on this leg. Nor are fresh challenges cheap:
`/mfa/webauthn/options`' login leg spends one and mints one, and `POST /auth/mfa/methods`
neither spends nor mints. A second *guess* costs a fresh
`POST /auth/login`, which is metered on `credential`. That is the door —
ten sign-ins per fifteen minutes per normalized address, so tens of guesses an hour against a
six-digit code rather than the half a million it would otherwise take. (The one other way a
`LOGIN` challenge is minted, the federated callback, is unmetered and is the subject of its
own paragraph below; reaching it means passing the provider's own authentication as that
account.)

**Which knob an operator turns.** Raising `THROTTLE_CREDENTIAL_LIMIT`, or widening
`THROTTLE_CREDENTIAL_WINDOW_MS`, raises the MFA grind rate in the same proportion.
`THROTTLE_MFA_ATTEMPT_LIMIT` does not move it at all, for the reason above. An operator who
wants to loosen sign-in for a shared address and keep the second factor as hard as it is now
cannot get that from these two numbers.

**`mfa-attempt` is kept, and it is not dead.** Its subject is the signed-in account whenever
there is one, so it binds the enrolment leg of `POST /mfa/webauthn/verify` — which proves an
existing factor and spends no login challenge per guess — where it is the counter doing the
work. It is also the budget that would bind the login legs the day one of them stops spending
the challenge before checking the proof; dropping it because it is slack today would make
that change silently unbounded. Its window is the challenge's own time to live, so where it
does bind a challenge the budget dies with it.

**`mfa-mint` bounds minting, not guessing.** A per-challenge cap alone resets whenever a new
challenge is minted, and this bucket is what stops somebody who holds the password from
buying a fresh per-challenge budget on demand. No route carrying it hands out a net new
`LOGIN` challenge, so it is not what holds the login door either.

Every limit and window is an environment variable with the default above, read through
`@nestjs/config` like every other setting. **There is no switch that disables throttling.**
A deployment-wide "off" is a security control that fails silently when somebody sets it and
forgets; tests that need different limits supply them through the module's async factory,
which is the framework's own way of configuring it.

**The federated callback mints a challenge and is not metered.** `oauth.service.ts` mints a
LOGIN challenge on the federated path as well as the password path, and that route carries no
budget — it has no server-known subject before the exchange completes, which is the same
reason `GET /auth/oauth/:provider` has none. It is not a way around the per-challenge budget
for somebody else's account: reaching it means passing the provider's own authentication as
that account. It is stated because the sentence "minting is metered" would otherwise be true
of one path and read as true of both.

**`POST /auth/reset-password`'s budget bounds replay, not guessing.** Its subject is the
credential presented, so a caller trying a different credential each time is a different
subject every time, each at one attempt of its allowance. What bounds guessing there is the
credential's own entropy; this budget bounds a spent or leaked link being retried. Stated
because the alternative — resolving the credential to an account inside the tracker — would
put a database lookup where a tracker must not have one and would reintroduce the
account-existence oracle §4.4 exists to prevent.

`GET /auth/oauth/:provider` is **not** throttled. It carries no server-known subject — there
is no account yet and no credential in the request — so the only available key is the one
§4.2 rules out. The abuse it leaves open is growth of `oauth_authorization_requests`, which
Phase 4's sweep already bounds.

### 4.4 Refusal, and what it must not disclose

Exhaustion refuses for a stated retry window and then rolls on its own. Nothing is locked,
no state is carried on the account, and no administrator or email round-trip is needed to
recover. An attacker who holds the password can make a second factor unavailable for
minutes; they cannot make it unavailable until support intervenes. That is the better of the
two failures, and it keeps a generated project from having to ship an unlock endpoint, its
mail, and an administrative surface it never asked for.

`throwThrottlingException` is overridden to raise `TooManyAttemptsError`, a `DomainError` in
`libs/core/src/shared/errors/` — cross-domain, because the rule spans authentication,
identities and second factors. It joins `http-exception.filter.ts`'s table with
`HttpStatus.TOO_MANY_REQUESTS` and its own translation key. This is ADR-0013's adaptation
clause: without it the library's own exception bypasses both the table every other failure in
this application goes through and the translation that table performs. Its documentation
describes a budget and says nothing about a status code, a header or a framework, because
K2 reads it.

**The `credential` bucket must count before anything looks the account up.** If only
addresses that resolve to an account are metered, then a refusal for a real address and a
rejection for an unknown one differ observably, and the mechanism built to harden sign-in
becomes an account-existence oracle. ADR-0005 states that a rejection reason is recorded and
never returned on an authentication path; K7 polices it. The subject is the submitted
address, normalized, whether or not it names anybody.

### 4.5 Storage

The library's bundled storage is an in-process map. On one replica it is correct. On several
each process keeps its own counter, so the effective limit becomes the configured one
multiplied by the replica count — silently, with every test green, because nothing in a
single-process suite can observe it. This repository has recorded that failure shape twice
already: Phase 4's fail-open default on a column the database does not constrain, and Phase
3's "a check that cannot fail is worse than an absent one".

So the `ThrottlerStorage` interface — one method, returning four numbers — is implemented
over Postgres:

```
CREATE TABLE rate_limit_counters (
  key           text        PRIMARY KEY,
  hits          integer     NOT NULL,
  expires_at    timestamptz NOT NULL,
  blocked_until timestamptz NULL
)
```

The increment is one statement, so two processes racing cannot both read a stale count: an
upsert that resets the window when `expires_at` has passed and increments otherwise,
returning the row it wrote. A second statement sets `blocked_until` when the limit is
exceeded. Expired rows are swept on the write path, following the ruling recorded beside the
challenge store's sweep and ADR-0013's departure clause, not by a scheduled task.

No `GRANT` is written here. `ALTER DEFAULT PRIVILEGES` in the role migration covers tables
created after it, which the existing feature migrations already rely on and document.

A refusal is auditable, but **only the transition** — the request that first blocks a
subject writes one entry, not every subsequent refusal. Auditing each one would let an
attacker write unboundedly into `audit_entries` by continuing to attempt, turning a
protection into an amplifier. This adds one `AuditAction` member, which the hand-written
value map pins like every other.

### 4.6 What the guard model costs

The guard runs before the handler, so it counts **requests, not failures** — it cannot know
an outcome it precedes. The limits in §4.3 are therefore set against a ceiling on legitimate
use, not against a budget of failures. For these endpoints that is the right trade and the
numbers above reflect it. It is written down because it is a trade, and because the obvious
future request — "only count the ones that failed" — is a different mechanism, not a tuning.

## 5. Continuity of control

`decideMfaRemoval` already demands a live second-factor proof, and it is wired. But it
demands one only when the removal would leave **zero** confirmed methods, and it reasons
about the count of confirmed methods rather than about who controls them.

Enrolment is unguarded: `POST /mfa/totp/enroll` and `POST /mfa/totp/confirm` ask for nothing
but a live session. So a stolen session can enrol a second factor of its own, confirm it,
and then delete the owner's — permitted, because a confirmed method survives. The account
still has a second factor, exactly as the policy's documentation says, and it belongs to the
attacker. The guarantee never fires because the count never reaches zero.

**Confirming a factor when the account already holds a confirmed one requires a live proof
from an existing one.** The first factor requires none: there is nothing to prove with, and
demanding a proof would make enrolment impossible for the account that has not started —
which is the permanent-lockout failure `decideMfaRemoval`'s own documentation already argues
against for unconfirmed methods.

In `libs/core`, following the per-domain layout: `MfaEnrollmentDecision` in `mfa/enums/`,
`decideMfaEnrollment` in `mfa/policies/` — pure, no clock, no store, one symbol per file,
barrels updated, documentation on every export, and every switch over the new enum ending in
`assertNever` so a third member is a compile error rather than a fall-through. The confirm
endpoint accepts the same proof shape `POST /mfa/recovery-codes` already takes, which is an
existing contract rather than a new one.

`decideMfaRemoval`'s documentation is amended in the same change, because its present
argument reasons from a count and the property that actually holds is continuity of control.

## 6. The carried debt this phase drains

- **`ix_mfa_challenges_expires_at`.** The sweep scans without it. One statement, in the same
  migration as §4.5's table.
- **A bound on enrolled methods.** Nothing limits how many factors an account may enrol.
- **`loginOptions` rolls the challenge time-to-live indefinitely.** Each ceremony mints a
  fresh challenge, so a caller can hold one open for ever. The fix carries the original
  expiry forward, which is a change to the mint signature.
- **Nobody is told how many recovery codes remain.** The count is the account's, not a
  method's, so `GET /mfa/methods` becomes an envelope, `{ methods, recoveryCodesRemaining }`,
  and the security screen shows it, so a person can tell they are on their last one.
- **Recovery codes use a poor alphabet for transcription.** They move to Crockford base32,
  which excludes the characters a person reading from paper confuses. Existing codes are
  hashed and unaffected; only generation changes.

## 7. Testing

The usual gates apply unchanged. Three things are specific to this phase.

**This phase's payload is mostly wiring, and wiring is what silently fails to be attached.**
Phase 3's rule: any wiring owes an assertion that fails when it is deleted, plus the evidence
of having watched it fail. Removing the throttle from any one route must turn exactly one
test red, and the task is not done until that has been observed per route, not reasoned about.

**A new discriminating test, D16:** a subject that exhausts its budget is refused, and the
refusal is the domain error with its retry window — not the library's exception, and not a
`500`. It sits beside D1–D15 in the spec's discriminating-test table.

**The storage adapter gets a real-Postgres test**, not only the fake. The property that
matters — two processes sharing one counter — is precisely the one a fake cannot demonstrate,
and it is the reason the adapter exists. A fake-only suite here would be a check that cannot
fail.

The falsification standard applies to each: remove the code, confirm exactly the intended
tests fail and no others, restore.

## 8. Risks

- **The limits are guesses until somebody runs this in anger.** They are environment
  variables for that reason. The one that will be felt first is `credential`: a shared office
  address retrying a forgotten password is the plausible false positive.
- **`@nestjs/throttler` is a new dependency on the hot path of authentication.** An upgrade
  can change behaviour this project depends on. The adaptation points used here are its
  published ones, which is the part of its surface least likely to move.
- **The storage adapter is this phase's own hand-written code**, and it is the thing standing
  between the configured limit and the real one. It is small, and §7 is why it is tested the
  way it is.
- **Terminus changes what the container healthcheck means.** A readiness check that consults
  the database will report unready during a database restart where the old one reported ready.
  That is the correction; it is also a behaviour change an operator could experience as a
  regression, and it belongs in the generated project's changelog.
