import type { UserId } from '../../users/types/UserId';
import type { AuthIdentity } from '../entities/AuthIdentity';
import type { AuthIdentityId } from '../types/AuthIdentityId';

/**
 * Reading and unlinking the ways a person can prove who they are.
 *
 * Every method takes `actorId` — the user on whose behalf the call is made — as
 * its first parameter. Nothing is resolved from ambient state: an implementation
 * that decided for itself who was calling would be impossible to reason about
 * and impossible to test (ADR-0007).
 *
 * Linking a new identity is not here. An identity comes into being alongside
 * the proof it stands for, which is a capability of the service that holds that
 * proof, not of this one — and keeping it out is what lets this contract speak
 * only in entities that carry no secret material (ADR-0005).
 */
export interface IIdentityService {
  /**
   * The actor's own identities. There is no path to another user's.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns every identity the actor currently holds, as entities
   */
  listIdentities(actorId: UserId): Promise<AuthIdentity[]>;

  /**
   * Removes one of the actor's identities.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param identityId - the identity to remove
   * @throws LastIdentityRemovalError if it is the only one they have
   * @throws IdentityNotFoundError if it is not theirs — indistinguishable from
   * not existing, so the call cannot be used to probe for other people's ids
   * @see assertAtLeastOneIdentityRemains — the domain policy that decides both
   * of the above, in that order. Every implementation of this method calls it
   * rather than restating the rule as its own count query, because a second
   * copy of a rule is a copy that can diverge.
   */
  unlinkIdentity(actorId: UserId, identityId: AuthIdentityId): Promise<void>;
}
