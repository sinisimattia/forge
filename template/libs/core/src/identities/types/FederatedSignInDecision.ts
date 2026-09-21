import type { UserId } from '../../users/types/UserId';
import type { FederatedSignInOutcome } from '../enums/FederatedSignInOutcome';
import type { AuthIdentityId } from './AuthIdentityId';

/**
 * What {@link decideFederatedSignIn} decided, and what the caller needs in
 * order to act on it. One member per {@link FederatedSignInOutcome}, each
 * carrying only what that ending needs.
 */
export type FederatedSignInDecision
  = | {
    /** Discriminant: sign in the account this subject is already linked to. */
    readonly outcome: FederatedSignInOutcome.SIGN_IN_EXISTING;
    /** Who signs in. */
    readonly userId: UserId;
    /** The identity that proved it. */
    readonly identityId: AuthIdentityId;
  }
  | {
    /** Discriminant: provision a new account for this address. */
    readonly outcome: FederatedSignInOutcome.PROVISION_NEW;
    /** In normal form, so this address and a registered one are one address. */
    readonly email: string;
    /** As the provider disclosed it, unaltered. */
    readonly displayName: string | null;
  }
  | {
    /** Discriminant: refuse; an existing account already holds this address. */
    readonly outcome: FederatedSignInOutcome.REFUSE_EMAIL_BELONGS_TO_ANOTHER_ACCOUNT;
    /** For the audit record. **Never returned to whoever made the attempt.** */
    readonly existingUserId: UserId;
  }
  | {
    /** Discriminant: refuse; the address is absent or unverified. */
    readonly outcome: FederatedSignInOutcome.REFUSE_UNVERIFIED_EMAIL;
  };
