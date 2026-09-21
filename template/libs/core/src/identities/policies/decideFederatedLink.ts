import { FederatedLinkOutcome } from '../enums/FederatedLinkOutcome';
import type { FederatedLinkDecision } from '../types/FederatedLinkDecision';
import type { FederatedLinkInput } from '../types/FederatedLinkInput';

/**
 * Whether a federated subject may be linked to the account making the request.
 *
 * ## Why this is a separate function rather than a fifth {@link FederatedSignInOutcome}
 *
 * A sign-in attempt has nobody yet: part of what it must decide is whether an
 * asserted address belongs to somebody. A link request is made by somebody who
 * has **already proven who they are** — the actor is the account, established
 * by the session the request is made under — so "does this address belong to
 * an existing account" is not a question this rule ever asks; it does not even
 * look at the address. Folding the two into one function would give link
 * requests a branch that exists only for sign-in and that no link test could
 * ever reach, or force {@link decideFederatedSignIn} to accept an actor it has
 * no use for. Two rules, each taking exactly what its own question needs, is
 * the honest shape.
 *
 * ## The three endings
 *
 * 1. **Nothing holds the subject** ({@link FederatedLinkOutcome.LINK}).
 * 2. **The actor already holds it** ({@link FederatedLinkOutcome.ALREADY_LINKED_TO_ACTOR}).
 *    Linking again is idempotent, not an error: a client that retries a link
 *    after losing the response to a lost connection must not be told the
 *    retry failed when the first attempt already succeeded.
 * 3. **Somebody else holds it** ({@link FederatedLinkOutcome.LINKED_TO_ANOTHER_ACCOUNT}).
 *    Refused, and — see {@link FederatedLinkDecision} — refused without saying
 *    whose account it is, because unlike a sign-in refusal this one goes back
 *    to the actor who asked.
 *
 * Unlike {@link decideFederatedSignIn}'s four checks, 2 and 3 above are not
 * ordered against each other for a security reason: once `linkedIdentity` is
 * resolved it can name at most one owner, so "the actor holds it" and
 * "somebody else holds it" can never both be true of the same input. The
 * `null` check ahead of both is load-bearing — it is the only one of the three
 * conditions that is not the negation of the others — the rest is written in
 * the order that reads as the more specific case first.
 *
 * Pure: no clock, no store, no I/O. Everything it needs is in `input`.
 *
 * @param input - the actor, plus the one lookup only a store can do
 * @returns which of the three endings applies, and what that ending needs
 */
export function decideFederatedLink(input: FederatedLinkInput): FederatedLinkDecision {
  const { actorUserId, linkedIdentity } = input;

  if (linkedIdentity === null) {
    return { outcome: FederatedLinkOutcome.LINK };
  }

  if (linkedIdentity.userId === actorUserId) {
    return {
      outcome: FederatedLinkOutcome.ALREADY_LINKED_TO_ACTOR,
      identityId: linkedIdentity.id,
    };
  }

  return { outcome: FederatedLinkOutcome.LINKED_TO_ANOTHER_ACCOUNT };
}
