# ADR-0006: Authorization Is a Pure Function in Core

- **Status:** Accepted
- **Date:** 2026-09-18
- **Relates to:** [ADR-0005](0005-identity-is-separate-from-user.md), [ADR-0007](0007-tenancy-is-explicit-never-ambient.md)

## Context

Access rules are written twice in most applications. The server writes them once, in
guards, to reject requests. The client writes them again, in slightly different words, to
decide which buttons to render — because a UI that offers an action the API will refuse is
worse than one that hides it.

The two copies drift. They drift quietly, because neither one fails when they disagree:
the UI hides an action the user was allowed to take, or offers one the API rejects with an
error the user cannot act on. Nothing breaks, no test goes red, and the divergence is
discovered by a user filing a confused bug report.

Duplicating the rule is also duplicating the *place* the rule can be wrong. A role gains a
permission in the server's map and not the client's, and the product has two answers to
the same question with no way to tell which one is authoritative.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

Authorization is **one pure function in `__FORGE_SCOPE__/core`**:

```
can(principal, permission, resource?) -> boolean
```

No input it does not receive as an argument. No lookup, no state, no clock, no
persistence — given the same principal and the same resource it returns the same answer,
which is what makes it callable from both sides.

It evaluates three layers in order:

1. **Platform role** — operating the deployment itself. `PLATFORM_ADMIN` passes
   everything, and every such pass is recorded in the audit log.
2. **Organization role** — a static `role -> permission[]` map in core. `Permission` is a
   `resource:action` string union, so a typo is a compile error rather than a silent deny
   that nobody notices until someone cannot do their job.
3. **Resource grant** — the explicit exception roles cannot express ("this one person, on
   this one record"). Grants are additive only and never reach across a tenant boundary.

**The server enforces; the client only predicts.** This is the rule that makes sharing the
function safe, and it is not optional:

- The backend calls `can()` to **decide whether a request proceeds**. Its answer is the
  one that matters, and every route is authorized on the server whether or not any client
  ever asks.
- The webapp calls the *same* `can()` to **decide what to render**. Its answer is a
  prediction about what the server would say, made from a principal the browser holds. It
  is a user-experience affordance and carries no security weight whatsoever.

A client-side `true` is never a permission. It is a guess that happens to be right almost
always, and the server re-derives the answer from its own principal on every request.

This ADR is recorded before the organization layer exists, because the platform-role layer
is live from the first release: `PLATFORM_ADMIN` already passes everything, and code
written against a partial model tends to encode the partial model permanently.

## Consequences

### Positive

- A button is hidden by exactly the rule that would have rejected the request. The UI and
  the API cannot disagree about who may do what, because there is only one statement of
  it.
- Permissions are a checked string union, so an invented or renamed permission fails the
  build instead of silently denying at runtime.
- The rule set is testable in isolation — a pure function over plain data needs no server,
  no database and no browser to prove correct, and the same test covers both callers.
- A new consumer (a job runner, a second client) inherits the rules by calling the same
  function rather than writing a third copy.

### Negative

- **The webapp can compute a decision the server has not blessed.** The same call means
  "this is permitted" on one side and "this is probably permitted" on the other, and
  nothing in the type system distinguishes them. The rule has to be stated, taught and
  held by review; the first time someone treats a client-side `true` as an authorization,
  the model has been defeated and everything still compiles.
- **Purity has to be paid for up front.** `can()` cannot look anything up, so the caller
  must hydrate the full principal — memberships, grants — before asking, including on
  requests the platform layer would have answered immediately.
- **A rule that genuinely needs a lookup cannot be expressed here.** Anything depending on
  the state of the record being acted on has to be a domain check elsewhere, so
  authorization is not, in fact, all in one place — only the role-and-grant part of it is.
- **The static map is a deploy-time artifact.** Changing what a role may do is a code
  change and a release, not an administrative action. That is a deliberate trade against
  runtime-editable permissions, and it will be the wrong one for a product that needs
  customer-defined roles.
