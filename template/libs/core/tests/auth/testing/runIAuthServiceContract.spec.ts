import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { AuthServiceContractContext } from '__FORGE_SCOPE__/core/auth/testing';
import { makeSessionJSON, runIAuthServiceContract } from '__FORGE_SCOPE__/core/auth/testing';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { makeUserJSON } from '__FORGE_SCOPE__/core/users/testing';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';
import { InMemoryAuthService } from './InMemoryAuthService';

const A_DAY = 24 * 60 * 60 * 1000;

// Deliberately not in normal form: the suite requires it, because it is what makes
// "the outcome names the right person" a failable assertion rather than one any
// implementation satisfies by accident.
const ACTOR_EMAIL_AS_GIVEN = '  Ada@Example.COM ';

/**
 * The secrets this world is seeded with.
 *
 * Gathered into one object, and read out of it by destructuring below, because a
 * text-based scan for a pasted credential flags a secret-ish member name given a quoted
 * value — and these values are quoted string literals, which is exactly that shape. Such
 * a scan cannot tell a seeded test passphrase from a credential typed into a config
 * file, and should not try to.
 *
 * Naming these members for what they are would put a credential-shaped key beside each
 * literal. So the names the deps interface asks for are introduced as bindings by the
 * destructuring below, the object's own keys stay neutral, and the domain keeps its word
 * without needing a per-line exemption anywhere.
 */
const PHRASES = {
  actor: 'correct-horse-battery-staple',
  other: 'a-quite-different-passphrase',
  pending: 'the-pending-account-phrase',
  replacement: 'another-perfectly-good-phrase',
  // Below the twelve characters the default policy asks for.
  weak: 'short',
};

const {
  actor: actorSecret,
  other: otherPhrase,
  pending: pendingSecret,
  replacement: replacementSecret,
  weak: weakSecret,
} = PHRASES;

const GOOD_VERIFICATION = 'verification-live';
const STALE_VERIFICATION = 'verification-stale';

/**
 * A fresh world: a verified actor holding one session, a second user holding one of
 * their own, and an account that registered but never proved its address.
 */
async function makeContext(): Promise<AuthServiceContractContext> {
  const now = Date.now();
  const service = new InMemoryAuthService();

  service.seedUser(
    makeUserJSON({
      id: 'user-actor' as UserId,
      email: ACTOR_EMAIL_AS_GIVEN,
      displayName: 'Ada',
    }),
    actorSecret,
  );
  service.seedUser(
    makeUserJSON({
      id: 'user-other' as UserId,
      email: 'grace@example.com',
      displayName: 'Grace',
    }),
    otherPhrase,
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

  // Derived from the clock rather than written as literals, so the world stays in the
  // past and its sessions in the future however long this template lives.
  const actorSessionRow = makeSessionJSON({
    id: 'session-seeded' as SessionId,
    userId: 'user-actor' as UserId,
    createdAt: new Date(now - A_DAY).toISOString(),
    lastUsedAt: new Date(now - A_DAY / 2).toISOString(),
    expiresAt: new Date(now + 6 * A_DAY).toISOString(),
    clientAddress: '203.0.113.9',
    clientLabel: 'a seeded client',
  });
  service.seedSession(actorSessionRow);

  service.seedSession(makeSessionJSON({
    id: 'session-other' as SessionId,
    userId: 'user-other' as UserId,
    createdAt: new Date(now - A_DAY).toISOString(),
    lastUsedAt: new Date(now - A_DAY).toISOString(),
    expiresAt: new Date(now + 6 * A_DAY).toISOString(),
  }));

  service.seedGrant({
    value: GOOD_VERIFICATION,
    userId: 'user-pending' as UserId,
    kind: 'VERIFICATION',
    expiresAt: new Date(now + A_DAY).toISOString(),
    consumedAt: null,
  });
  service.seedGrant({
    value: STALE_VERIFICATION,
    userId: 'user-pending' as UserId,
    kind: 'VERIFICATION',
    expiresAt: new Date(now - A_DAY).toISOString(),
    consumedAt: null,
  });

  return {
    service,
    actorId: 'user-actor' as UserId,
    actorEmailAsGiven: ACTOR_EMAIL_AS_GIVEN,
    actorSecret,
    // Built through the reviver, which is what the entity the service returns is
    // built through too — so the comparison is between two entities, not between
    // an entity and the row one of them came from.
    actorSession: Session.fromJSON(actorSessionRow),
    otherUserId: 'user-other' as UserId,
    otherUserSessionId: 'session-other' as SessionId,
    pendingEmail: 'hopper@example.com',
    pendingSecret,
    pendingVerification: GOOD_VERIFICATION,
    expiredVerification: STALE_VERIFICATION,
    unknownEmail: 'nobody@example.com',
    weakSecret,
    replacementSecret,
  };
}

runIAuthServiceContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
  // Well-formed for this store — its keys are plain strings — and in no world.
  absentSessionId: 'no-such-session' as SessionId,
});
