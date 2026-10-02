import type { UserId } from '../../users/types/UserId';
import type { AuthIdentity } from '../entities/AuthIdentity';
import type { FederatedAccount } from './FederatedAccount';

/**
 * Everything `decideFederatedSignIn` needs, gathered by the caller from
 * whatever store it uses. The rule itself does no lookup of its own.
 */
export interface FederatedSignInInput {
  /** What the provider asserted about the person in front of it. */
  readonly account: FederatedAccount;
  /**
   * The identity already linked to `account.provider` + `account.subject`, if
   * any — looked up by the caller before this rule runs.
   */
  readonly linkedIdentity: AuthIdentity | null;
  /**
   * The account already holding `account.email` in normal form, if any —
   * looked up by the caller before this rule runs.
   *
   * Typed as just the id, not the full `User`, on purpose: this rule
   * reads exactly one field off whatever it is given, and the type should say
   * exactly that. Widening it to `User` would let a future edit read `status`
   * or `deletedAt` off this value and start deciding whether the account may
   * be *used* — which `decideFederatedSignIn`'s own TSDoc says is
   * deliberately not this function's job — without the compiler ever
   * objecting. A narrower type makes that mistake impossible to make by
   * accident rather than merely discouraged.
   */
  readonly userWithMatchingEmail: { readonly id: UserId } | null;
}
