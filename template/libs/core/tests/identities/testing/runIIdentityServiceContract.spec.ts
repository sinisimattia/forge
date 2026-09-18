import type { IIdentityService } from '__FORGE_SCOPE__/core/identities/contracts';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { assertAtLeastOneIdentityRemains } from '__FORGE_SCOPE__/core/identities/policies';
import type { IdentityServiceContractContext } from '__FORGE_SCOPE__/core/identities/testing';
import {
  makeAuthIdentityJSON,
  runIIdentityServiceContract,
} from '__FORGE_SCOPE__/core/identities/testing';
import type {
  AuthIdentityId,
  AuthIdentityJSON,
} from '__FORGE_SCOPE__/core/identities/types';
import type { ConformanceExpect } from '__FORGE_SCOPE__/core/shared/testing';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

/**
 * A reference implementation over a Map of wire rows.
 *
 * It stores rows rather than entities on purpose: that is the shape a real
 * implementation has to map back into an entity on every read, so the suite is
 * driven through the same rehydration a real one performs. The unlink rule is
 * not restated here — it calls the domain policy, which is the whole point of
 * the policy being a pure function over the identities themselves.
 */
class InMemoryIdentityService implements IIdentityService {
  private readonly rows = new Map<string, AuthIdentityJSON>();

  constructor(seed: readonly AuthIdentityJSON[]) {
    for (const row of seed) this.rows.set(row.id, row);
  }

  async listIdentities(actorId: UserId): Promise<AuthIdentity[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === actorId)
      .map((row) => AuthIdentity.fromJSON(row));
  }

  async unlinkIdentity(actorId: UserId, identityId: AuthIdentityId): Promise<void> {
    const owned = await this.listIdentities(actorId);
    assertAtLeastOneIdentityRemains(owned, identityId);
    this.rows.delete(identityId);
  }
}

/** Adapts jest's assertions to the runner-agnostic surface the suite is driven through. */
const conformanceExpect: ConformanceExpect = {
  equal: (actual, expected) => {
    expect(actual).toBe(expected);
  },
  ok: (value) => {
    expect(value).toBeTruthy();
  },
  rejects: async (operation, errorType) => {
    await expect(operation()).rejects.toBeInstanceOf(errorType);
  },
};

// Deliberately not in normal form: the suite requires the world to be built
// from an account identifier the domain has to normalize, so that normalization
// is something an implementation can be caught failing to do.
const PASSWORD_ACCOUNT_AS_GIVEN = '  Ada@Example.COM ';

/** A fresh world holding three users: two with a pair of identities, one with a single identity. */
async function makeContext(): Promise<IdentityServiceContractContext> {
  const actorPasswordRow = makeAuthIdentityJSON({
    id: 'identity-1' as AuthIdentityId,
    userId: 'user-1' as UserId,
    provider: AuthProvider.PASSWORD,
    providerAccountId: PASSWORD_ACCOUNT_AS_GIVEN,
    lastUsedAt: '2026-02-02T00:00:00.000Z',
  });
  const actorFederatedRow = makeAuthIdentityJSON({
    id: 'identity-2' as AuthIdentityId,
    userId: 'user-1' as UserId,
    provider: AuthProvider.GOOGLE,
    providerAccountId: 'subject-90210',
  });
  const otherFirstRow = makeAuthIdentityJSON({
    id: 'identity-3' as AuthIdentityId,
    userId: 'user-2' as UserId,
    providerAccountId: 'grace@example.com',
  });
  const otherSecondRow = makeAuthIdentityJSON({
    id: 'identity-4' as AuthIdentityId,
    userId: 'user-2' as UserId,
    provider: AuthProvider.GITHUB,
    providerAccountId: 'subject-4711',
  });
  const soleRow = makeAuthIdentityJSON({
    id: 'identity-5' as AuthIdentityId,
    userId: 'user-3' as UserId,
    providerAccountId: 'only@example.com',
  });

  return {
    service: new InMemoryIdentityService([
      actorPasswordRow,
      actorFederatedRow,
      otherFirstRow,
      otherSecondRow,
      soleRow,
    ]),
    actorId: 'user-1' as UserId,
    actorIdentities: [
      AuthIdentity.fromJSON(actorPasswordRow),
      AuthIdentity.fromJSON(actorFederatedRow),
    ],
    passwordAccountIdAsGiven: PASSWORD_ACCOUNT_AS_GIVEN,
    otherUsersIdentityId: 'identity-3' as AuthIdentityId,
    soleIdentityUserId: 'user-3' as UserId,
    soleIdentityId: 'identity-5' as AuthIdentityId,
  };
}

runIIdentityServiceContract({
  describe,
  it,
  expect: conformanceExpect,
  makeContext,
  // Well-formed for this store — its keys are plain strings — and in no world.
  absentIdentityId: 'no-such-identity' as AuthIdentityId,
});
