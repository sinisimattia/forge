# ADR-0005: Identity Is Separate From User

- **Status:** Accepted
- **Date:** 2026-09-18
- **Relates to:** [ADR-0006](0006-authorization-is-a-pure-function-in-core.md), [ADR-0008](0008-ports-not-vendors.md)

## Context

The cheapest way to start an application with accounts is a `users` table with an email
column and a password-hash column beside it. That shape encodes an assumption — one person
has exactly one way to prove who they are — and the assumption holds right up to the first
request for "sign in with a provider", "link my work account", or "we are moving to
single sign-on".

At that point the shape has to change, and the change is not additive. A provider-issued
subject identifier has nowhere to live, so it becomes another nullable column; a second
provider becomes a third set of columns; "which of these columns is the account's real
identity" becomes a question every query has to answer. The alternative — splitting the
concepts later — is a migration that rewrites every account in every deployment of the
generated project, run against production data, at the moment the team is busy shipping the
feature that forced it.

The password hash sitting on the `users` row is the second problem. `User` is the entity
every response about a person is built from, so the hash travels with the person through
every mapper, serializer and test fixture, and only convention keeps it out of the response.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

The domain models **two** concepts, and they are separate entities in
`__FORGE_SCOPE__/core`:

- **`User`** — a person. Profile, status, platform role. One per human.
- **`AuthIdentity`** — *one way of proving you are that person*. A provider, the subject
  identifier that provider knows the person by, and the user it is bound to. Many per user.

**Password is not special.** It is simply the `PASSWORD` provider — one `AuthIdentity` row
like any other. There is no privileged column and no "real" identity; a person with a
password and two federated logins has three rows that differ only in provider.

**The core `AuthIdentity` entity carries no secret material.** No hash, no provider
credential, no refresh material — the entity models *which* proof exists, never the proof
itself. Verifying a credential is the job of the service implementing the contract, against
storage the domain entity does not describe.

**A rejection reason is recorded, never returned.** An authentication attempt that fails
produces an outcome the server can audit in full — unknown subject, wrong credential,
unverified, suspended — and a response to the caller that is identical in every case.
Distinguishing them to an unauthenticated caller is account enumeration, so the wire shape
on an authentication path has no field for the reason.

**At least one usable identity must remain.** Unlinking is a row lifecycle with exactly one
invariant, enforced in the domain rather than in each caller.

## Consequences

### Positive

- Adding a provider is an insert, not a migration. The model that costs the most to change
  is the one that is fixed up front.
- Account linking and unlinking are ordinary row operations under a single invariant,
  rather than a feature bolted onto a column layout that cannot express them.
- A hash cannot leak into a response by accident, because the entity the response is built
  from has no field to leak: the guarantee is structural rather than a convention every
  mapper has to remember.
- Authentication logic reads the same for every provider, so a provider-specific bug has
  one place to be rather than one place per column.

### Negative

- **Two tables and a join on the hottest path in the system.** Every sign-in resolves an
  identity and then the user behind it. The split is paid on the request that happens most.
- **A password-only account carries an `AuthIdentity` row a column would have covered.**
  For a project that never adds a second provider, this is pure overhead — a row per
  account, and a second write on registration, bought entirely on the expectation of a
  provider that may never arrive.
- **"Find the user by email" becomes ambiguous.** The account's own address and a
  provider-asserted address are different facts, and every lookup has to say which it
  means. Treating them as interchangeable is the account-takeover path this model exists to
  make visible, so the ambiguity is deliberate — but it is still ambiguity a single table
  did not have.
- **Identical rejection responses make support harder.** A user who cannot sign in gets a
  response that does not say why, and the reason is recoverable only from the audit record
  by someone with access to it.
