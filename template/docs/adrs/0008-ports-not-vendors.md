# ADR-0008: Ports, Not Vendors

- **Status:** Accepted
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

**Every external capability is a port — an interface in `__FORGE_SCOPE__/core` — and the
template ships a development adapter behind it, never a vendor binding.**

- The domain depends on the *capability* ("deliver this message to this address"), stated
  as an `I*Service` contract in core. It never depends on a provider, and never names one.
- Each port ships with a development adapter that satisfies the contract with no external
  account: the shipped mail adapter writes the message to disk instead of sending it.
- **The template binds no third-party account and carries no keys.** Every credential in a
  generated project is an unpopulated environment variable.
- **A provider registers itself only when its configuration is present.** An unconfigured
  provider is simply absent — not a crash at start-up, and not a button that fails when
  someone presses it.
- Binding a real provider is writing one adapter against the existing port and configuring
  it. No domain code changes, because no domain code named the provider.

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
