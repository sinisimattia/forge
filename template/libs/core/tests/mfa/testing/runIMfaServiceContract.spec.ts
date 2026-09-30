import type { MfaServiceContractContext } from '__FORGE_SCOPE__/core/mfa/testing';
import { runIMfaServiceContract } from '__FORGE_SCOPE__/core/mfa/testing';
import type { MfaMethodId, TotpEnrollmentOffer } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';
import { InMemoryMfaService } from './InMemoryMfaService';

/**
 * A fresh world: two users, neither holding a method yet. The suite mints
 * and confirms whatever it needs through the contract itself.
 */
async function makeContext(): Promise<MfaServiceContractContext> {
  return {
    service: new InMemoryMfaService(),
    actorId: 'user-actor' as UserId,
    otherUserId: 'user-other' as UserId,
    // InMemoryMfaService's own TSDoc explains the simplification: a code
    // verifies exactly when it equals the secret it was offered for.
    validCodeFor: (offer: TotpEnrollmentOffer) => offer.secret,
    // Well-formed for this store — its keys are plain strings — and in no world.
    absentMethodId: 'no-such-method' as MfaMethodId,
  };
}

runIMfaServiceContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
});
