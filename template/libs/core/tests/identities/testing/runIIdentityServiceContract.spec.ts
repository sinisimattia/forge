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
import { explain } from '__FORGE_SCOPE__/core/shared/testing';
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

/**
 * Adapts jest's assertions to the runner-agnostic surface the suite is driven through.
 *
 * The optional message is part of that surface, and a host that drops it turns "the
 * world must seed the password identity in a form the domain has to normalize" into
 * `Received: false` at a line number — an unreadable failure gets worked around rather
 * than fixed. Jest accepts at most one argument to `expect`, so the message is raised as
 * the failure itself where jest's own report says nothing a reader needs (`ok`), and put
 * in front of it by the shared `explain` helper where the diff is worth keeping.
 */
const conformanceExpect: ConformanceExpect = {
  equal: (actual, expected, message) => {
    try {
      expect(actual).toBe(expected);
    } catch (error) {
      throw explain(error, message);
    }
  },
  ok: (value, message) => {
    if (!value && message !== undefined) throw new Error(message);
    expect(value).toBeTruthy();
  },
  rejects: async (operation, errorType, message) => {
    try {
      await expect(operation()).rejects.toBeInstanceOf(errorType);
    } catch (error) {
      throw explain(error, message);
    }
  },
};

// Deliberately not in normal form: the suite requires it, because it is what
// makes the wire-shape comparison bite. An implementation that hands back the
// row its store holds, rather than rebuilding the entity from it, returns a
// providerAccountId that differs visibly from the promised one.
const PASSWORD_ACCOUNT_AS_GIVEN = '  Ada@Example.COM ';

/** A fresh world holding two users: the actor with a pair of identities, and one with a single. */
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
  // The second user's ONLY identity. It is both the last-identity case and the
  // not-yours case, and it has to be their last one for the second of those to
  // catch an implementation that checks the count before ownership.
  const soleRow = makeAuthIdentityJSON({
    id: 'identity-3' as AuthIdentityId,
    userId: 'user-2' as UserId,
    providerAccountId: 'grace@example.com',
  });

  return {
    service: new InMemoryIdentityService([actorPasswordRow, actorFederatedRow, soleRow]),
    actorId: 'user-1' as UserId,
    actorIdentities: [
      AuthIdentity.fromJSON(actorPasswordRow),
      AuthIdentity.fromJSON(actorFederatedRow),
    ],
    passwordAccountIdAsGiven: PASSWORD_ACCOUNT_AS_GIVEN,
    soleIdentityUserId: 'user-2' as UserId,
    soleIdentityId: 'identity-3' as AuthIdentityId,
  };
}

// The adapter's third argument is the contract's, and both reference drivers dropped it
// silently through Tasks 4 and 5 — every explanatory message in both suites went to
// nothing. Pinned here so the next driver cannot quietly do it again: a plan rule asks,
// a test enforces.
describe('the jest conformance adapter', () => {
  it('raises the suite\'s message when `ok` fails', () => {
    expect(() => {
      conformanceExpect.ok(false, 'the world must seed a normalizable value');
    }).toThrow('the world must seed a normalizable value');
  });

  it('keeps jest\'s own report underneath the message when `equal` fails', () => {
    expect(() => {
      conformanceExpect.equal(1, 2, 'the two sides must agree');
    }).toThrow(/the two sides must agree[\s\S]*Expected: 2[\s\S]*Received: 1/);
  });
});

runIIdentityServiceContract({
  describe,
  it,
  expect: conformanceExpect,
  makeContext,
  // Well-formed for this store — its keys are plain strings — and in no world.
  absentIdentityId: 'no-such-identity' as AuthIdentityId,
});
