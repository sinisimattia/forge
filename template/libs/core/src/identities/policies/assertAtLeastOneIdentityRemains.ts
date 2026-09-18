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
 * The order of the two checks is load-bearing, and not for the reason it might
 * look like: it is about what each error *claims*, not about what a caller can
 * learn. `LastIdentityRemovalError` says "removing that identity would leave the
 * account with no way in", which is a false statement about an identity the
 * account does not hold — it asserts the caller owned something it never did,
 * and refuses on a ground that was never the real one. An error that lies about
 * what it refused is worse than no error, because the person reading it looks
 * for a second identity to add before retrying and there was never anything to
 * fix. Not-found is therefore decided first, so the refusal always names the
 * reason that is actually true.
 *
 * Deciding the count first would in fact reveal strictly *less* — an absent id
 * and a present one would both come back as `LastIdentityRemovalError` for a
 * one-identity list. That is not an argument for this order, and it is not an
 * argument against it either: `identities` is the actor's own list, which they
 * can already read in full, so neither order is an enumeration oracle.
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
