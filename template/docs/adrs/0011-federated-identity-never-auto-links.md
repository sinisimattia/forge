# ADR-0011: A Federated Address Links Nothing

- **Status:** Accepted
- **Date:** 2026-09-21
- **Relates to:** [ADR-0005](0005-identity-is-separate-from-user.md), [ADR-0008](0008-ports-not-vendors.md)

## Context

A federated sign-in callback carries an email address the provider says it verified. There
is an account in this database that already answers to that same address. The obvious thing
to do — the thing that makes onboarding friction disappear — is to treat the match as proof
and sign the caller into that account, linking the provider to it on the way in.

That address match is not proof of anything this application should trust. A provider
verifying an address means the provider confirmed control of a mailbox *at the moment that
provider's account was created* — it says nothing about who controls that mailbox now, and
nothing at all about who created the account on **this** system under the same string. Any
service that lets someone register using an arbitrary address they do not own, or that lets
mailbox control be lost and regained (an expired domain, an offboarded employee's forwarding
rule, a provider with lax verification of its own), turns "prove you own this address" into
"prove you can currently receive one email at this address" — a much weaker claim, and one
an attacker can often arrange to satisfy.

**The attack, stated plainly:** an account already exists here for `ada@example.test`,
created with a password Ada chose. Somebody who is not Ada creates a Google account using
`ada@example.test` — reachable if Ada's mail is briefly misdelivered, if the address is a
shared or role mailbox, if a domain lapsed and was re-registered, or simply if Google's own
verification is satisfied by something short of "this person is Ada." That somebody then
clicks "Sign in with Google" here. If a verified-address match is enough to link and sign
in, they now hold Ada's account — her data, her memberships, everything reachable through
it — without ever having presented her password or anything else this application itself
issued her. The federated provider's promise ("we verified this address") was never a
promise about *this application's* account; treating it as one is how the attacker gets in.

This is a Forge template default. Supersede it with a new ADR if this project needs
something different.

## Decision

**A federated provider's assertion about an address never links to an existing account.
Linking a federated identity to an account requires an authenticated session — proof, made
to this application, that the caller already controls the account being linked.**

- `decideFederatedSignIn` (`libs/core/src/identities/policies/decideFederatedSignIn.ts`)
  checks an already-linked subject first, unconditionally — a provider that later stops
  disclosing a verified address must not lock someone out of an account they already hold.
  Failing that, an unverified or absent address is refused outright. Failing that, a
  **verified** address that already belongs to an account is *also* refused
  (`REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT`) — and nothing is written: no identity row, no
  session. Only an address nobody holds provisions a new account.
- The refusal is recorded (`AuditAction.FEDERATED_LINK_REFUSED`) against the account that
  already existed, not against anything derived from the unauthenticated assertion — nothing
  has been established yet about whoever made the attempt.
- The only route from "a provider asserts an address I also use" to "that provider is linked
  to my account" is: sign in the way you already can (password, or a provider you have
  already linked), and from that authenticated session, deliberately link the new provider.
  `decideFederatedLink` (`libs/core/src/identities/policies/decideFederatedLink.ts`) is a
  **separate** function from `decideFederatedSignIn`, not a shared branch of it — a link
  request has an actor, established by the session it is made under, and does not even look
  at the asserted address; a sign-in attempt has nobody yet, and the address is the only
  thing it has to decide with. Folding the two into one function would give one a branch the
  other's tests could never reach.
- `IdentitiesController.beginLink` and the corresponding callback path are that deliberate
  route, gated by the same global session guard as every other authenticated endpoint.
  Discriminating test D11 (`apps/backend/src/__tests__/discriminating/d11-federated-email-match.spec.ts`)
  drives both halves through a real routed application: the unauthenticated callback refuses
  and links nothing, and the authenticated link endpoint, reached with the same provider and
  the same asserted address, succeeds.

## R2: no ID-token verification, and what a deployment needing one would do

Every adapter behind `IOAuthProvider` (`apps/backend/src/auth/oauth/IOAuthProvider.ts`)
resolves an account by exchanging an authorization code for an access credential directly
against the provider's token endpoint — server to server, over TLS — and then reads the
account from the provider's userinfo endpoint with that credential. `authorizationUrl`
builds a string the *browser* carries, and nothing it returns is trusted, because a browser
can rewrite anything it is handed. `fetchAccount` is the only method that speaks to the
provider, and it never receives anything from the browser except the authorization code and
this application's own PKCE verifier.

That asymmetry is why this template verifies no ID token, anywhere. An ID token matters
when a claim about identity has to be trusted *without* a server-to-server exchange — the
classic case is a single-page app that receives a token directly from the provider in the
browser and has to prove that token was not forged or substituted before acting on it, which
means fetching the provider's signing keys (JWKS), handling their rotation, and pinning the
signing algorithm so a token is not accepted signed a weaker way than intended. None of that
applies here: the credential this application acts on was never in the browser's hands to
tamper with, because this application went and got it directly. Verifying a signature on top
of that would be re-establishing, at the cost of three surfaces this template would then
have to own (JWKS fetching, key rotation, algorithm selection), a property the transport
already gives for free.

A deployment that genuinely needs to trust an ID token — because it is integrating a client
that receives one directly, or because a provider's userinfo endpoint is less trustworthy
than its signed token for some reason specific to that provider — is doing something this
port was not built for, and should write a new adapter (or extend `IOAuthProvider`
deliberately) that fetches the provider's JWKS, verifies the signature, checks `aud`, `iss`
and `exp`, and only then proceeds. That is real, additional work, and it belongs in the
adapter that needs it — not folded into every provider on the strength of one deployment's
requirement.

## R10: the development adapter, and its two start-up refusals

`DevOAuthProvider` (`apps/backend/src/auth/oauth/adapters/DevOAuthProvider.ts`) is
`IOAuthProvider`'s development adapter under ADR-0008: the template binds no developer
application at any real provider, so this is what a generated project ships until somebody
registers one. It authenticates nobody — it asserts one address, configured once
(`OAUTH_DEV_EMAIL`), with no credential presented and no human step of any kind.

That total bypass is exactly why `buildOAuthProviders`
(`apps/backend/src/auth/oauth/oauth.config.ts`) refuses to *start* the application, rather
than merely declining to register the adapter, under two conditions:

1. **`OAUTH_DEV_ENABLED` set alongside `NODE_ENV=production`.** An adapter that
   authenticates nobody must never be reachable by a real user. A silent decline — quietly
   not registering the adapter and letting the deployment boot with one fewer provider —
   was rejected because it hides the actual misconfiguration behind a symptom ("Google sign-in
   isn't showing up") that could take a long time to connect back to the real cause,
   compared to a boot failure naming the variable to unset.
2. **`OAUTH_DEV_ENABLED` set alongside a real generic OIDC provider.** Both answer to the
   same `AuthProvider.OIDC` enum member — there is no separate member for "the fake one,"
   because nothing about a persisted identity needs to carry that distinction. Registering
   both would give `OAuthProviderRegistry.find('OIDC')` two adapters answering to one name,
   with no way to say which one a sign-in actually went through beyond the order lines
   happen to run in this file. **Silent precedence between a real provider and one that
   authenticates nobody is the worst available outcome** — worse than refusing either
   configuration outright, because a deployment that believes it configured its real OIDC
   provider would sometimes be handing out sign-ins that verified nothing, with everything
   about the response looking identical either way. This factory refuses both configurations
   before either adapter is built, naming both variables in the error.

## Consequences

### Positive

- The address-takeover attack described above has no code path: `decideFederatedSignIn`
  cannot reach `PROVISION_NEW` or `SIGN_IN_EXISTING` for a verified address that belongs to
  somebody else, and nothing calls `decideFederatedLink` without an authenticated actor to
  supply it.
- No JWKS client, no key rotation handling, and no algorithm allow-list anywhere in this
  template — three surfaces of a kind that produce their own long history of
  misconfiguration (accepting `alg: none`, trusting an unpinned key) elsewhere, simply do
  not exist here, because the transport already gives the property they would have proven.
- The development adapter cannot become a silent production backdoor: it either runs where
  it is inert (development) or the process does not start at all.

### Negative

- **A person with a password account who clicks "Sign in with Google" is refused, on
  purpose, if Google asserts the address their password account already uses.** From their
  side this looks like a bug — "I have an account, why won't it let me in?" — and it will be
  reported as one. Whoever triages that report needs to read this ADR before "fixing" it by
  loosening the check: the friction is the point, and the remedy is already built (sign in
  the way you can, then link deliberately), not missing.
- **The spec's alternative — a verified-email challenge as a second route to linking, where
  this application itself sends a confirmation to the address and treats a click as proof —
  is not built.** The authenticated session is the *only* route to a link in this template.
  A project that wants the gentler onboarding of an email-challenge route has to build it,
  and should read the attack above carefully before doing so: a challenge email this
  application controls the sending of is a materially different proof than a provider's
  say-so, but it is still a new piece of machinery with its own ways to get wrong (token
  reuse, an address that is no longer the requester's, a race with account deletion) that
  this ADR's decision avoided needing at all.
- **A deployment cannot offer "sign in with any of these, we'll figure out it's the same
  person"** — every provider a person wants to use has to be linked once, deliberately, from
  an authenticated session. That is more steps for someone who reaches for a second provider
  before ever setting a password, and there is no way to skip them without reopening the
  attack this ADR exists to close.
