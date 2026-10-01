# ADR-0013: The Framework's Own Answer, First

- **Status:** Accepted
- **Date:** 2026-10-01
- **Relates to:** [ADR-0008](0008-ports-not-vendors.md)

## Context

Every framework ships answers to the problems every application has: validating input,
parsing a parameter, limiting how often something may be attempted, reporting whether the
process is healthy, fetching over the network, holding state across a navigation. A project
can use those answers or write its own.

Writing its own is always available and always looks cheaper at the moment of writing,
because the hand-rolled version is shaped exactly to the one call site in front of the
author. The cost arrives later and lands on somebody else. A hand-rolled mechanism is code
this project now owns: it has to be tested here, documented here, kept correct here, and
understood by everyone who arrives afterwards — none of whom have seen it before, all of
whom have seen the framework's. The framework's version is already documented, already
maintained by people who work on nothing else, already familiar to the next person, and
already has its own answers to the edge cases this project has not yet hit.

The second cost is specific to a template. **This project is a starting point that other
people will change.** Whoever generates a project from it will substitute pieces for their
own. A substitution is easy when the thing being replaced is the framework's standard
component used in the standard way, and hard when it is a bespoke mechanism whose behaviour
exists only in this repository's source. Every hand-rolled mechanism is a thing the next
person must first understand before they may remove it.

This is a __FORGE_TITLE__ template default. Supersede it with a new ADR if this project
needs something different.

## Decision

**When the framework already provides a mechanism, use it, and adapt it at its own
extension points rather than replacing it.** This holds on both sides of the workspace:
`@nestjs/*` packages and the framework's built-in guards, pipes, filters and interceptors in
the backend; the equivalent modules and built-in composables in the webapp. Prefer the
mechanism the project does not have to own.

**Adapting is the normal case, not a failure.** A framework component rarely fits
unmodified, and the right response is its published extension point — not a copy with the
inconvenient part edited out. The shipped `ParseUuidParamPipe` is the pattern: it is the
framework's own parameter pipe, constructed with an `exceptionFactory` so that a malformed
parameter produces this application's translation key instead of the framework's hard-coded
English. The mechanism stays the framework's; only the part that had to answer to a local
contract is supplied locally.

**The adaptation goes in the component, never in `__FORGE_SCOPE__/core`.** Core's purity
rules are the fixed point of this decision: core imports no framework package and names none
in its prose, so a framework component that wants to reach a domain rule is adapted on the
app side of that boundary. In particular, a component that raises its own framework-shaped
error is adapted to raise the domain error instead, so it arrives where every other failure
in this application arrives rather than bypassing the structures that translate and shape a
response. Where the framework states a capability as an interface and this project supplies
the implementation, that is this decision and [ADR-0008](0008-ports-not-vendors.md) agreeing:
the framework provides the port, the project provides the adapter.

### What this decision does not cover

[ADR-0008](0008-ports-not-vendors.md) governs **external capabilities** — anything reached
outside this process, over a network, through an account somebody had to register. Those are
ports with development adapters behind them, and the fact that a framework package exists for
one does not change that: the question ADR-0008 asks is about the credential and the vendor
binding, not about who wrote the client.

This decision governs **mechanisms the framework provides in-process**, where there is no
account, no credential and no third party beyond the framework the project has already
committed to. The test is whether choosing it binds the project to anyone new. Using the
framework's rate limiter binds the project to the framework it already runs on. Using a
hosted service to do the rate limiting is an external capability and belongs to ADR-0008.

### Departing from it

A departure is allowed and must be written down where the code is, stating what the
framework's answer is and what specifically it fails to do here. A departure that cannot
name the framework's answer has not considered it.

The shipped departure is the expiry sweep: the framework offers scheduled tasks, and the
challenge store sweeps expired rows on the path that writes them instead, because a sweep
on a path nothing calls is a sweep nobody notices has stopped. That reasoning is recorded
beside the sweep, which is where somebody changing it will be standing.

A justification is part of the artifact and no gate reads it. A departure resting on a
claim about the framework that is not true is worse than no justification, because it reads
as having been checked. State what the framework's component does only after confirming it.

## Consequences

### Positive

- Less code owned here: the mechanism's edge cases, its upgrades and its documentation
  belong to someone else.
- A person who knows the framework already knows how this application does these things,
  and the parts they do not recognize are the parts that are genuinely this project's own.
- Substitution gets easier, which is the point of a template: replacing a standard component
  used in the standard way is a known operation.
- Adapting at a published extension point tends to survive an upgrade; a fork of the
  component's internals does not.

### Negative

- **A dependency per mechanism**, each with its own release cadence, and an upgrade can
  change behaviour this project depends on without this project changing at all.
- **The framework's shape is not always the domain's shape**, and the adaptation can cost
  more than the mechanism would have. When it does, that is a departure — write down what
  was weighed.
- **A framework default can be wrong here and still be silent.** A component chosen for
  familiarity arrives with defaults chosen for the general case; the default that does not
  fit this application fails quietly, because nothing about a default announces itself. The
  adaptation is where that gets caught, so a component adopted without reading its defaults
  has not been adopted carefully.
- **Familiarity is not correctness.** This decision is a tie-breaker between workable
  options, not a reason to adopt a component that does not do the job.
