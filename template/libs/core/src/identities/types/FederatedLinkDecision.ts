import type { FederatedLinkOutcome } from '../enums/FederatedLinkOutcome';
import type { AuthIdentityId } from './AuthIdentityId';

/**
 * What {@link decideFederatedLink} decided. One member per
 * {@link FederatedLinkOutcome}, each carrying only what that ending needs.
 *
 * `LINKED_TO_ANOTHER_ACCOUNT` deliberately carries no user id, unlike
 * `FederatedSignInDecision`'s `REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT`: that
 * one is consumed by an audit record the actor who triggered it never sees,
 * while this one is consumed by the response to the very actor whose request
 * failed. Disclosing whose account holds the subject would hand that actor a
 * fact about somebody else's account they have no standing to learn.
 */
export type FederatedLinkDecision
  = | {
    /** Discriminant: nothing holds this subject; it is linked to the actor. */
    readonly outcome: FederatedLinkOutcome.LINK;
  }
  | {
    /** Discriminant: the actor already holds this subject; a no-op. */
    readonly outcome: FederatedLinkOutcome.ALREADY_LINKED_TO_ACTOR;
    /** The identity that already proves it. */
    readonly identityId: AuthIdentityId;
  }
  | {
    /** Discriminant: somebody else holds this subject; refused. */
    readonly outcome: FederatedLinkOutcome.LINKED_TO_ANOTHER_ACCOUNT;
  };
