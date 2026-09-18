# ADR-0007: Tenancy Is Explicit, Never Ambient

- **Status:** Accepted
- **Date:** 2026-09-18
- **Relates to:** [ADR-0006](0006-authorization-is-a-pure-function-in-core.md)

## Context

Once an application has tenants, every tenant-scoped query needs to know which tenant it
is for. Threading that identifier through every call is repetitive, so the standard
shortcut is to resolve it once per request and stash it somewhere ambient — request-scoped
context, async-local storage, a mutable singleton — where any layer can reach it without
being handed it.

The shortcut has one failure mode, and it is the worst one available: a query that forgets
to apply the scope returns another tenant's rows, and **nothing fails**. No exception, no
red test, no log line. The code reads as if it were scoped, because the scope is invisible
at the call site — which is precisely what made it convenient. The bug is found when a
customer sees data belonging to someone else.

Ambient scope also lies in every context that is not a request. A background job, a
migration, a test and a script all run with the ambient value unset or, worse, left over
from something else.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

**Every tenant-scoped operation takes its `organizationId` as an explicit parameter.**

- Contract methods in `__FORGE_SCOPE__/core` that read or write tenant-scoped data declare
  `organizationId` in their signature. A method that does not declare it is, by
  construction, not tenant-scoped.
- There is no ambient "current organization" — no async-local storage, no request-scoped
  singleton, no module-level mutable holder. A layer that needs the tenant is given it.
- Resolving which organization a request is for happens once, at the edge, and the result
  is **passed down as a value**, not stored where callees can reach for it.
- The audit record carries an explicit, nullable `organizationId` for the same reason: a
  change worth reconstructing later is recorded together with the tenant it happened in,
  supplied by the caller and never inferred. It is nullable because platform-level actions
  genuinely belong to no tenant, and recording "none" is a fact, not a missing value.

Explicitness is not the whole guarantee — passing an identifier does not prove it is one
the caller is entitled to, and that check still belongs to `can()`
([ADR-0006](0006-authorization-is-a-pure-function-in-core.md)). What explicitness buys is
that the check is *possible*: the scope is visible in the signature, so a reviewer, a type
and a test can all see whether it was applied.

This ADR is recorded before any organization entity exists, because the audit log arrives
first and the temptation to resolve "the current organization" from ambient state arrives
with the first tenant-scoped query. A convention adopted after the first ambient lookup
has to remove one, which is much harder than never adding it.

## Consequences

### Positive

- A missing tenant scope is visible in the signature and at the call site, so review, the
  compiler and the tests can all catch what ambient scope hides.
- Tests, jobs, scripts and migrations call the same methods as a request does, with no
  context to set up and no ambient state to simulate.
- Cross-tenant operations — a platform-wide audit query, an administrative report — are
  ordinary calls rather than special cases that have to defeat the ambient mechanism.
- The blast radius of a mistake is one call site, not every call made while some ambient
  value was wrong.

### Negative

- **Every tenant-scoped signature carries the parameter forever**, including the many
  where it feels redundant — a lookup by an identifier that is already globally unique
  still takes the organization, because "this one cannot leak" is exactly the reasoning
  that produces the one that can.
- **It is verbose, and verbosity invites erosion.** The parameter is threaded through
  layers that do nothing with it but pass it on, and each of those is a place where
  someone will propose a context object to tidy things up.
- **Explicit is not automatic.** A caller can still pass the wrong organization, and the
  signature will accept it. This decision makes the check visible; it does not perform it.
- **Retrofitting a tenant-scoped method that was written without the parameter is a
  breaking change** to every caller, rather than an invisible change to an ambient
  resolver.
