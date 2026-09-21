# ADR-0010: Organization Invitations Are Single-Use, Expiring, Hashed and Address-Checked

- **Status:** Accepted
- **Date:** 2026-09-21
- **Relates to:** [ADR-0007](0007-tenancy-is-explicit-never-ambient.md),
  [ADR-0006](0006-authorization-is-a-pure-function-in-core.md)

## Context

An organization needs a way to admit somebody who does not yet belong to it. Every
authorization layer this project has assumes a membership already exists: `can()`'s second
layer reads the actor's role *in this organization*, and `PermissionsGuard` refuses anyone
with no membership row. An invitation is the one path that crosses that boundary from
outside, so it is the one credential in the system whose holder is, by construction, not
yet a member of the thing it admits them to.

That makes it a bearer credential mailed to an address, which is a shape with well-known
failure modes: it is forwarded, it is quoted in a support ticket, it sits in a mailbox
somebody else later gains access to, and — if it is stored as it was sent — a copy of the
table is a set of working credentials. It is also a shape that invites an accidental
oracle: the endpoint that redeems one is reachable by anybody, and every distinct answer it
gives is something an unauthenticated caller has learned.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

**An invitation is a single-use, expiring credential, stored only as a digest, and checked
against the redeemer's own address at the moment it is redeemed.**

- **Single-use.** Redemption happens inside one transaction that takes a row lock on the
  invitation before reading its state, and the status update is predicated on the row still
  being `PENDING`. A second redemption of the same token — concurrent or sequential — finds
  the row `ACCEPTED` and is refused. Two *different* invitations to one address are refused
  the same way, by a membership read taken under the same lock plus a unique-violation
  mapping behind it, so an address that already belongs cannot be admitted twice.
- **Expiring.** `INVITATION_TTL_SECONDS` is seven days. Expiry is **not** a status: there
  is no `EXPIRED` member of `InvitationStatus`, deliberately, because expiry is a fact that
  becomes true while nothing is running, and storing it would mean every read had to repair
  the row before trusting it — in exactly the path where that repair gets forgotten.
  `Invitation.isOpenAt(now)` answers both halves at once, and it is what redemption calls.
- **Hashed.** The token is 32 bytes from the platform CSPRNG, base64url-encoded. Only
  `sha256(token)` is persisted, in `organization_invitations.token_hash` under
  `uq_organization_invitations_token_hash`; the cleartext exists in the mail and nowhere
  else. The digest is a plain SHA-256
  rather than a password derivation, because the input is full-entropy and uniformly random
  — there is no guessing to slow down. Lookup is *by digest*, so no branch on the path
  compares two secrets and there is no secret-dependent timing to measure.
- **Address-checked at redemption.** The invitation names an address; redemption compares
  it against the signed-in redeemer's own account address and refuses on mismatch. The
  token alone is not sufficient. A forwarded link is therefore not a transferable
  membership, which is the property that makes mailing a bearer credential acceptable at
  all.
- **The three closed states answer identically; never-issued stays distinct.** Revoked,
  accepted and expired all raise `InvitationNoLongerOpenError` → `410` with the shared
  `errors.http.gone` key and the single code `INVITATION_NO_LONGER_OPEN`. A token that
  never named anything raises `InvitationNotFoundError` → `404`, `INVITATION_NOT_FOUND`.
- **Openness is judged before the address.** A holder of a closed token is told it is
  closed; they are never told whose it was.

### Why never-issued stays distinct, when the codebase collapses this elsewhere

Elsewhere in this project a "you may not" is deliberately made indistinguishable from a
"there is no such thing": `PlatformAdminGuard` answers `404` rather than `403`, and
`OrganizationNotFoundError` shares `UserNotFoundError`'s message key so the body cannot
reintroduce what the status closed. That collapse exists to shut an **enumeration oracle**
— and an enumeration oracle needs a guessable identifier. A user id or an organization id
is a value an attacker can hold without ever having been given it, so a distinguishable
answer about one turns the endpoint into a directory.

An invitation token is not that. It is 32 bytes from a CSPRNG; nobody can present a token
that was "real once" without having held it. There is no set to enumerate and no oracle to
close, so collapsing the two answers would buy exactly nothing — and it would cost a real
person, who clicked a forwarded or since-revoked link, the only comprehensible answer
available to them: *this invitation is no longer open*, rather than *no such invitation*,
which is false.

**The distinction is therefore conditional on the token, not on the endpoint.** If a later
phase ever shortens the token, makes it human-typable, derives it from anything guessable,
or exposes invitations under a sequential identifier, this argument stops holding and both
the error and its wire mapping must be revisited together.

The three *closed* reasons are collapsed for the opposite reason, and that one is
unconditional: the holder of a closed token has already proved nothing about themselves,
and telling them whether it was revoked, spent or merely stale reports on an organization's
internal decisions to somebody who is not in it. Openness is judged before the address for
the same reason — reversing the order leaks the worse thing, because the rightful holder
would get `410` while a wrong holder got `403`, which tells a forwarded-mail recipient that
the token is addressed to someone else.

## Consequences

### Positive

- A stolen database is not a set of working invitations. A dump gives digests, and the
  cleartext was never stored.
- A forwarded link admits nobody: the address check makes the token necessary but not
  sufficient.
- No repair pass, no scheduled job and no `EXPIRED` sweep — an invitation that has aged out
  simply stops being open, and every reader asks the same question at the same instant.
- An unauthenticated caller probing the redemption endpoint learns exactly one bit it did
  not already have: whether a token it already holds is still open.
- Redeeming twice is impossible under concurrency as well as sequentially, and both halves
  are exercised by their own test rather than by one that happens to cover both.

### Negative

- **An invitation cannot be resent — only reissued.** The cleartext is gone the moment the
  mail is built, so "send me that link again" means issuing a new invitation. An
  organization can therefore accumulate several open invitations for one address; each is
  single-use, and all but the first are refused at redemption.
- **The address check makes an invitation non-transferable in cases where a person would
  want it to be** — somebody invited at a work address who signs up with a personal one is
  refused, correctly by this rule and annoyingly in practice, and has no self-service
  remedy but to ask for a new invitation.
- **Seven days is a single global constant**, not a per-organization policy. Shortening it
  for a security-sensitive deployment or lengthening it for a slow onboarding is a code
  change.
- **The never-issued/closed distinction is a standing obligation on future work.** It is
  safe only while the token is unguessable, and nothing in the type system enforces that
  precondition — it is held by this ADR and by `InvitationNotFoundError`'s own TSDoc.
