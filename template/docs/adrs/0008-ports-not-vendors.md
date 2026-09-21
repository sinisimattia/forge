# ADR-0008: Ports, Not Vendors

- **Status:** Accepted — amended 2026-09-21 with "Where a port lives, and the test for
  deciding", which corrects a clause the shipped code had never satisfied
- **Date:** 2026-09-18
- **Relates to:** [ADR-0005](0005-identity-is-separate-from-user.md)

## Context

A project template that ships a working integration with an external service has to ship
somebody's account. Whoever generated the project inherits credentials pointing at a
mailbox, a developer application or a key vault that belongs to the template's author —
and every project generated from it points at the same one. The template becomes a shared
dependency on a third party nobody agreed to, and a leaked credential in it is a leak in
every project ever generated.

The alternative most templates reach for is the opposite extreme: no integration at all,
with the external call written inline wherever it is needed and a `TODO` beside it. That
defers the cost rather than removing it. The first real provider is then wired directly
into the domain flow, its client is imported by the service that needed it, and swapping
it later means touching every place it was called.

Both problems are the same problem: the external capability was never given a shape of its
own.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

**Every external capability is a port — an interface, never a vendor binding — and the
template ships a development adapter behind it.**

- Whatever depends on the capability depends on the *capability* ("deliver this message to
  this address"), stated as an interface. It never depends on a provider, and never names
  one.
- Each port ships with a development adapter that satisfies the contract with no external
  account: the shipped mail adapter writes the message to disk instead of sending it.
- **The template binds no third-party account and carries no keys.** Every credential in a
  generated project is an unpopulated environment variable.
- **A provider registers itself only when its configuration is present.** An unconfigured
  provider is simply absent — not a crash at start-up, and not a button that fails when
  someone presses it.
- Binding a real provider is writing one adapter against the existing port and configuring
  it. No domain code changes, because no domain code named the provider.

### Where a port lives, and the test for deciding

**A port belongs to the layer whose vocabulary the capability is stated in.**

- **In `__FORGE_SCOPE__/core`, when the domain itself has to name the capability.**
  `IBreachedPasswordRegistry` is the shipped example: "is this password already public?" is
  a question the domain asks on its own behalf — `PasswordPolicyViolation.BREACHED` is a
  domain outcome — so the contract is stated in core and every consumer is held to it.
- **In the app that needs it, when only that app has the vocabulary.** `IMailer`
  (`apps/backend/src/mail/`), `IPasswordHasher`
  (`apps/backend/src/identities/hashing/`) and `IOAuthProvider`
  (`apps/backend/src/auth/oauth/IOAuthProvider.ts`) are the shipped examples, and all three
  are deliberate. Core has no notion of a message, an address or a delivery mechanism, no
  notion of a derivation algorithm or its cost parameters, and no notion of an authorization
  endpoint, a token exchange or a redirect URI; stating any of the three in core would mean
  writing a deployment's transport concerns into the one package whose value is that it
  carries none. `IOAuthProvider` is stated as "which provider this is, and what it asserts
  about the account behind an exchanged code" — the domain-level questions
  `decideFederatedSignIn` and `decideFederatedLink` (see ADR-0011) actually ask are stated in
  core, over a `FederatedAccount` value the port hands back, not over the port itself. Core's
  purity rule (`libs/core/STANDARDS.md`, and the `purity` gate that enforces it) is not a
  style preference that a port may be excused from — it is the reason a contract in core
  means anything.

The test is **whose question is it?** If a domain rule, a domain entity or a domain error
would have to name the capability to be stated at all, the port goes in core. If only the
app's own plumbing names it, the port goes in the app, beside the adapter and the DI token
that binds it. Everything else in this ADR — no vendor in the contract, a development
adapter behind every port, no shipped credential — applies identically in both places.

*This clause was written after the fact.* The original decision said every port is an
interface in core, `IMailer` and `IPasswordHasher` were built in the backend anyway for
the reason above, and `IMailer`'s own TSDoc argued against the ADR that governed it. The
sentence was corrected rather than the code, because moving those two contracts into core
would import transport vocabulary into core to satisfy a sentence — the wrong direction.

## Consequences

### Positive

- A generated project runs end to end on the first clone, with no account to register and
  no key to obtain before anything works.
- The template carries no credential, so it cannot leak one, and no generated project
  inherits a dependency on the template author's account.
- Swapping a provider is one new adapter and a configuration change; the domain never
  learns that it happened.
- Ports are the natural test seam — a contract with a development adapter is already the
  fake the tests needed.

### Negative

- **The shipped mail adapter cannot actually send anything.** In a freshly generated
  project, the verification link is read off disk. Registration works, but only for
  someone with access to the machine, until a real provider is bound. This is the direct,
  deliberate price of not shipping an account — and it will surprise anyone who expects a
  working integration out of the box.
- **A port is only as wide as the providers it was imagined for.** A provider feature that
  falls outside the contract cannot be reached without widening the port, and a port
  widened to fit one provider's specialty has stopped being provider-independent.
- **One more layer to read through.** Following "what actually happens when this is
  called" means finding the binding before finding the code, which is a real cost for
  anyone new to the project.
- **The development adapter is a plausible thing to ship by accident.** Nothing about it
  fails loudly, so a deployment that never bound a real provider looks healthy while
  silently delivering nothing. That risk belongs to configuration review, not to the type
  system.
