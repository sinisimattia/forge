# ADR-0012: A Second Factor Belongs to the Account, Not to the Way In

- **Status:** Accepted
- **Date:** 2026-09-30
- **Relates to:** [ADR-0005](0005-identity-is-separate-from-user.md), [ADR-0011](0011-federated-identity-never-auto-links.md)

## Context

An account can be reached by more than one road: a password, or a federated provider. Each
road ends in the same act, issuing a session — unless the account owes a second factor, in
which case it ends in a challenge instead. A passkey is not a third road: it is one of the
ways of answering that challenge, and it cannot be reached without one.
A person who enrols a second factor is asking for a specific thing: *nobody gets in as me
on the strength of one secret alone.*

The tempting design attaches the second factor to the road. The password form asks for a
code; the account is, in the user's mind, "protected". It is easy to build, because the
password path is the one already in front of the developer, and it is wrong in a way that
looks finished. The federated callback is a second door into the same account. If it does
not ask, the account is exactly as strong as the weaker of its two doors, and the person who
enrolled a factor believes otherwise. A provider's assertion is a different proof from a
password, but it is still one proof, and the account owner did not say "one proof is enough
unless it is a password."

**The attack, stated plainly:** Ada has a password and an enrolled authenticator app. Her
password leaks. An attacker who has it meets the code prompt on the password form and
stops — but Ada also once linked a provider, and that provider's account is protected only
by whatever its own owner chose, or the attacker has taken over the mailbox behind it. The
attacker signs in through the provider, the callback finds Ada's account, and a session is
issued with no code asked. The factor Ada enrolled protected one door of two.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

**Whether a second factor is owed is decided about the account, in one place, and every
path that would open a session asks that place first.**

- `decideAuthenticationStep` (`libs/core/src/mfa/policies/decideAuthenticationStep.ts`) is
  pure. It is handed the account's methods and answers either `ISSUE_SESSION` or
  `REQUIRE_SECOND_FACTOR` with the methods that may satisfy it. It takes no argument
  describing how the person arrived, so it cannot answer differently for one road than for
  another; there is nothing for a road-specific rule to read.
- Every path that begins a session for an *existing* account consults it before
  `SessionService.begin`: the password sign-in (`AuthService.signIn`) and the federated
  callback (`OAuthService.completeSignIn`). The federated path that provisions a brand-new
  account consults it too, although a new account has no confirmed method, because a rule
  that is skipped "where it cannot matter" is a rule the next change to that path will skip
  where it can.
- **The rule is enforced by the type system rather than by this document.**
  `SessionService.begin`/`beginIn` require a `SecondFactorSettled`
  (`apps/backend/src/auth/session/second-factor-settled.ts`), a class with a private member
  and a private constructor — so nothing structurally similar is assignable to it and the
  only values in existence are the ones its own factories made. There are three factories,
  one per premise: the policy answered `ISSUE_SESSION`; the factor was just proven; the
  caller already holds an access token (the one case below). The first returns a
  discriminated union whose evidence is reachable only through the issuing arm, so a caller
  cannot obtain it without having written the `REQUIRE_SECOND_FACTOR` branch. A new path
  that opens a session without asking does not compile. **Adding a fourth premise is an
  edit to that file and owes an argument here.**
- **`REQUIRE_SECOND_FACTOR` issues nothing.** No session row, no access token, no renewal
  cookie. What comes back is a single-use challenge bound to the account. Spending that
  challenge is not the same act as opening a session, and the two must not be read as one:
  a passkey ceremony spends a challenge to get the nonce it will be answered against, and
  issues nothing either. A session is opened only where `SecondFactorSettled` evidence can
  be produced, which is the structural point above — a path that opens one on a premise
  those factories do not name does not compile. Discriminating test D10
  (`apps/backend/src/__tests__/discriminating/d10-mfa-challenge-only.spec.ts`) counts
  `sessions` rows rather than trusting a response body, and the Docker walk repeats the
  count against a real database, including two requests racing on one challenge.
- **A federated sign-in that owes a factor arrives at the same challenge as a password one.**
  The browser redirect from the callback carries the challenge to `/mfa/challenge`; from
  there the two roads are one road.
- **Only a confirmed method gates.** An enrolment that was started and never finished asks
  nothing of anybody: a method nobody has proven can produce a response is not a stronger
  gate but a lock nobody holds a key to, and it would turn an abandoned enrolment into a
  lockout. `decideAuthenticationStep` filters to confirmed methods first, and only what
  survives can change its answer.
- **Removing the last confirmed method is defeating the factor, and costs the same.**
  `decideMfaRemoval` requires a fresh proof of a second factor, not the password, to remove
  the last confirmed method. A password would fail an account that has none (a federated
  signup), and against a hijacked session the password is no stronger than the session.
- A policy that consults the account's methods must read them through the transaction it
  will issue in on the one path where the two can differ (provisioning), so that the
  decision sees what that transaction has written and not a snapshot beside it.

## Consequences

### Positive

- The account is as strong as its second factor on every road that exists, and on every road
  added later that goes through session issuance the way these do. Adding a provider adds
  no way around the factor.
- One function to read to know when a factor is owed, and it is pure, so its whole truth
  table is a unit test.
- A federated sign-in and a password sign-in that owe a factor converge on one challenge
  and one verification, so the single-use and race properties are proven once.

### Negative

- **A person who signs in with a provider they trust completely is now asked for a code
  too**, and this will be reported as a bug: "I already proved who I am to Google." They
  proved it to Google. The account's owner asked this application to require a second
  proof, and the provider's assertion is one proof. Whoever triages that report should read
  this ADR before exempting a provider; an exemption is the attack above with a name on it.
- **The federated redirect has to carry a credential in a URL**, because a browser redirect
  has no other channel. That is contained, not eliminated: the challenge is single-use and
  short-lived, is taken into memory and out of the address bar and history by the challenge
  page, and the route is served with `Referrer-Policy: no-referrer` and rendered on the
  client only. A request line in a web server's access log still holds it for the one
  request that loaded the page.
- **A path that begins a session for somebody already holding one is not gated.** Re-issuing
  credentials after a password change goes to a caller who is already signed in; asking
  them for a code again would prove nothing new — the route carries no `@Public()`, so an
  access token has already been accepted for that account, and one cannot exist unless the
  policy was satisfied when the session behind it was opened. That is the whole of
  `becauseTheCallerAlreadyHoldsAnAccessToken`, and it is the one factory a project can
  misuse: it is true only for a path that opens a session for the *authenticated actor's
  own* account. An impersonation endpoint is the trap — the actor holds a token, the
  session is for somebody else, and nothing has asked about that person's second factor.
  A path that opens a session for anyone but the caller must use the policy instead.
- **The cost of making the rule structural is a parameter nothing reads.** `beginIn` takes
  the evidence and never looks at it, so the compiler and the linter both have to be told
  the parameter is deliberately unused. That is the whole price, and it buys a compile
  error where there used to be a comment.
- **Recovery codes are a second way past the factor by design.** They are single-use, hashed
  at rest, shown once, and regenerating them demands a fresh proof. An account that loses
  both its authenticator and its codes has no route back in through this application, which
  is the price of nothing else substituting for the factor.
