import { looksLikeAnAddress } from '../../shared/policies/looksLikeAnAddress';
import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import { FederatedSignInOutcome } from '../enums/FederatedSignInOutcome';
import type { FederatedSignInDecision } from '../types/FederatedSignInDecision';
import type { FederatedSignInInput } from '../types/FederatedSignInInput';

/**
 * Which account, if any, a federated assertion corresponds to.
 *
 * ## The order of the four checks is the security property
 *
 * 1. **An already-linked subject signs in, first and unconditionally.** The link
 *    was established under these same rules; the subject is the proof. A
 *    provider that later stops disclosing a verified address must not lock
 *    somebody out of an account they already hold, which is what any ordering
 *    that checked the address first would do.
 * 2. **An unverified address, an absent one, or one that is not shaped like an
 *    address at all is refused before it is compared with anything.** Not
 *    after — a comparison that happens and is then discarded is one refactor
 *    away from a comparison that is acted on. The shape check matters on its
 *    own: `emailVerified: true` is the provider's own claim, not a guarantee
 *    about the string it is attached to, and nothing downstream of
 *    `PROVISION_NEW` re-validates it — the value is written straight into
 *    storage a real registration reaches only through {@link User}'s own
 *    constructor, which enforces exactly this shape. A provider (or a
 *    misconfigured development one) asserting a verified non-address must
 *    fail here, not at the next unrelated read of the row it would otherwise
 *    create.
 * 3. **A verified address that belongs to an existing account is refused, and
 *    the assertion is NOT linked to it.** This is discriminating test D11 and
 *    the reason this function exists. A provider asserting an address proves it
 *    controls *that address at that provider*; it proves nothing about an
 *    account here that happens to answer to the same string. Silent linking on
 *    a provider-asserted address is a documented account-takeover path (spec
 *    §9.3): anyone able to create an account at any configured provider using
 *    somebody's address would inherit their account here. The remedy a person
 *    is given instead is the authenticated link flow — sign in the way you
 *    already can, then link the provider deliberately — which requires proving
 *    the account is yours first, and that is exactly the proof that was
 *    missing.
 * 4. **Everything left is a verified address nobody holds**, and becomes an
 *    account.
 *
 * Note what this function does **not** decide: whether the account it names may
 * actually be used. Deleted, suspended and unverified accounts are refused by
 * the same rule a password sign-in is refused by, applied by the caller, in the
 * order {@link AuthenticationRejectionReason} fixes. Deciding it twice would be two
 * rules that can disagree about whether a suspended account may sign in. That
 * is also why `input.userWithMatchingEmail` carries only an id: this function
 * has no use for, and must never be tempted to branch on, anything else an
 * account record holds.
 *
 * Pure: no clock, no store, no I/O. Everything it needs is in `input`.
 *
 * @param input - the assertion, plus the two lookups only a store can do
 * @returns which of the four endings applies, and what that ending needs
 */
export function decideFederatedSignIn(input: FederatedSignInInput): FederatedSignInDecision {
  const { account, linkedIdentity, userWithMatchingEmail } = input;

  if (linkedIdentity !== null) {
    return {
      outcome: FederatedSignInOutcome.SIGN_IN_EXISTING,
      userId: linkedIdentity.userId,
      identityId: linkedIdentity.id,
    };
  }

  if (
    account.email === null
    || !account.emailVerified
    || !looksLikeAnAddress(normalizeEmail(account.email))
  ) {
    return { outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL };
  }

  if (userWithMatchingEmail !== null) {
    return {
      outcome: FederatedSignInOutcome.REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT,
      existingUserId: userWithMatchingEmail.id,
    };
  }

  return {
    outcome: FederatedSignInOutcome.PROVISION_NEW,
    email: normalizeEmail(account.email),
    displayName: account.displayName,
  };
}
