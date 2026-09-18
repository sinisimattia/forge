import type { AuthIdentity } from '../entities/AuthIdentity';
import { IdentityNotFoundError } from '../errors/IdentityNotFoundError';
import { LastIdentityRemovalError } from '../errors/LastIdentityRemovalError';
import type { AuthIdentityId } from '../types/AuthIdentityId';

/**
 * The unlink invariant: a user must always keep at least one way in.
 *
 * Expressed here, as a pure function over the identities themselves, rather
 * than as a query in an implementation — because it is a rule about the domain,
 * and because an implementation that enforced it with its own count query would
 * be a second, divergeable copy of it. Every implementation of
 * {@link IIdentityService} calls this.
 *
 * The order of the two checks is load-bearing. Not-found is decided first, so a
 * caller holding an id that is not among `identities` always gets the same
 * answer whether that id belongs to somebody else, has already been removed, or
 * never existed. Deciding the count first would answer differently for an id
 * that exists, which is how trying ids in turn becomes a way to discover them.
 *
 * @param identities - every identity the user currently holds
 * @param removingId - the identity the user proposes to remove
 * @throws IdentityNotFoundError when `removingId` is not among `identities`
 * @throws LastIdentityRemovalError when removing it would leave none
 */
export function assertAtLeastOneIdentityRemains(
  identities: readonly AuthIdentity[],
  removingId: AuthIdentityId,
): void {
  if (!identities.some((identity) => identity.id === removingId)) {
    throw new IdentityNotFoundError(removingId);
  }
  if (identities.length <= 1) {
    throw new LastIdentityRemovalError();
  }
}
