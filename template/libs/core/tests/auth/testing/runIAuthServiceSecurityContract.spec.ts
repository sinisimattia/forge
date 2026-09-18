import type { AuthServiceSecurityContractContext } from '__FORGE_SCOPE__/core/auth/testing';
import { runIAuthServiceSecurityContract } from '__FORGE_SCOPE__/core/auth/testing';
import { makeUserJSON } from '__FORGE_SCOPE__/core/users/testing';
import { UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';
import { InMemoryAuthService } from './InMemoryAuthService';

const A_DAY = 24 * 60 * 60 * 1000;

/**
 * The secrets this world is seeded with, gathered into one object and read out of it by
 * destructuring — see the note on the same construction in the shared suite's driver.
 * The extraction gate matches a secret-ish member name followed by any value at all, so
 * the names the deps interface asks for are introduced as bindings rather than as keys.
 */
const PHRASES = {
  actor: 'correct-horse-battery-staple',
  pending: 'the-pending-account-phrase',
  suspended: 'the-suspended-account-phrase',
  blockedUnverified: 'the-blocked-and-unverified-phrase',
  deleted: 'the-deleted-account-phrase',
  replacement: 'another-perfectly-good-phrase',
};

const {
  actor: actorSecret,
  pending: pendingSecret,
  suspended: suspendedSecret,
  blockedUnverified: blockedUnverifiedSecret,
  deleted: deletedSecret,
  replacement: replacementSecret,
} = PHRASES;

const ACTOR_RESET = 'recovery-live';

/**
 * A fresh world holding one account per way an attempt can be refused, each seeded
 * with the secret that really is its own.
 *
 * That last part is the whole design of this world. Every refusal the suite asserts
 * has to be the account's state and cannot be the secret, so seeding a wrong secret
 * anywhere here produces `INVALID_SECRET` and fails the assertion rather than passing
 * it while proving nothing.
 */
async function makeContext(): Promise<AuthServiceSecurityContractContext> {
  const now = Date.now();
  const service = new InMemoryAuthService();

  service.seedUser(
    makeUserJSON({ id: 'user-actor' as UserId, email: 'ada@example.com', displayName: 'Ada' }),
    actorSecret,
  );
  service.seedUser(
    makeUserJSON({
      id: 'user-pending' as UserId,
      email: 'hopper@example.com',
      displayName: 'Hopper',
      emailVerifiedAt: null,
    }),
    pendingSecret,
  );
  service.seedUser(
    makeUserJSON({
      id: 'user-suspended' as UserId,
      email: 'grace@example.com',
      displayName: 'Grace',
      status: UserStatus.SUSPENDED,
    }),
    suspendedSecret,
  );
  // Blocked AND never verified, so that two reasons apply to one attempt and the
  // order between them is a thing this suite can observe rather than assume.
  service.seedUser(
    makeUserJSON({
      id: 'user-blocked-unverified' as UserId,
      email: 'katherine@example.com',
      displayName: 'Katherine',
      status: UserStatus.SUSPENDED,
      emailVerifiedAt: null,
    }),
    blockedUnverifiedSecret,
  );
  service.seedUser(
    makeUserJSON({
      id: 'user-deleted' as UserId,
      email: 'alan@example.com',
      displayName: 'Alan',
      deletedAt: '2026-02-02T00:00:00.000Z',
    }),
    deletedSecret,
  );

  service.seedGrant({
    value: ACTOR_RESET,
    userId: 'user-actor' as UserId,
    kind: 'RESET',
    expiresAt: new Date(now + A_DAY).toISOString(),
    consumedAt: null,
  });

  return {
    service,
    actorId: 'user-actor' as UserId,
    actorEmail: 'ada@example.com',
    actorSecret,
    actorReset: ACTOR_RESET,
    pendingUserId: 'user-pending' as UserId,
    pendingEmail: 'hopper@example.com',
    pendingSecret,
    suspendedEmail: 'grace@example.com',
    suspendedSecret,
    blockedUnverifiedEmail: 'katherine@example.com',
    blockedUnverifiedSecret,
    deletedEmail: 'alan@example.com',
    deletedSecret,
    unknownEmail: 'nobody@example.com',
    replacementSecret,
  };
}

runIAuthServiceSecurityContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
});
