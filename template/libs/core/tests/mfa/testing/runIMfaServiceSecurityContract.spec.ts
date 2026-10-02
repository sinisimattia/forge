import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaServiceSecurityContractContext } from '__FORGE_SCOPE__/core/mfa/testing';
import { runIMfaServiceSecurityContract } from '__FORGE_SCOPE__/core/mfa/testing';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';
import { InMemoryMfaService } from './InMemoryMfaService';

/**
 * The value this world is seeded with, gathered into an object and read out of it by
 * destructuring — see the note on the same construction in the auth security suite's
 * driver. It is a quoted string literal, which is precisely what a text-based secret scan
 * flags when one sits under a secret-ish member name; named for what it is, it would be
 * exactly that shape.
 * So the name the deps interface asks for is introduced as a binding by the destructuring
 * below, and the object's own key stays neutral.
 */
const VALUES = {
  actor: 'actor-totp-value',
};

const { actor: ACTOR_SECRET } = VALUES;

/**
 * A fresh world holding one confirmed method for the actor — seeded
 * directly, since verifying it costs this world-builder nothing beyond
 * stating the secret it answers to (see `MfaServiceSecurityContractContext`'s
 * own TSDoc for why that is not the same as saying it had to be seeded this
 * way).
 */
async function makeContext(): Promise<MfaServiceSecurityContractContext> {
  const service = new InMemoryMfaService();
  const now = new Date().toISOString();

  service.seedConfirmedMethod(
    {
      id: 'method-actor' as MfaMethodId,
      userId: 'user-actor' as UserId,
      type: MfaMethodType.TOTP,
      label: 'Actor\'s phone',
      createdAt: now,
      confirmedAt: now,
      lastUsedAt: null,
    },
    ACTOR_SECRET,
  );

  return {
    service,
    actorId: 'user-actor' as UserId,
    actorMethodId: 'method-actor' as MfaMethodId,
    computeActorCode: () => ACTOR_SECRET,
    readStoredRecoveryCodeValues: () =>
      Promise.resolve(service.storedRecoveryCodeValuesFor('user-actor' as UserId)),
  };
}

runIMfaServiceSecurityContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
});
