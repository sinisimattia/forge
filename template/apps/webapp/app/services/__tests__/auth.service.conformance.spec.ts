import { describe, it } from 'vitest';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import { runIAuthServiceContract } from '__FORGE_SCOPE__/core/auth/testing';
import type { ClientContext, SessionId, SessionJSON } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { AuthHttpService } from '~/services/auth.service';
import { adaptVitestToConformanceExpect } from '~/test/adapt-vitest';
import { stubBackend } from './stubBackend';

/**
 * `AuthHttpService` against core's shared `IAuthService` suite — the same suite
 * the backend's `AuthService` is driven through, under a different runner.
 *
 * A gate; it produces nothing. See `user.service.conformance.spec.ts` for what
 * driving a shared suite from this side establishes.
 *
 * ## The promised session takes its client context from what the world ASKED FOR
 *
 * `actorSession` is built here from {@link HARNESS_CLIENT} and from this file's
 * own instants, and **not** by reading the session back out of the stub. The
 * suite's deps say why at length and the backend's driver carries the same note,
 * because it was measured there rather than reasoned: with both sides of the
 * wire-shape comparison read from the same place, an implementation that dropped
 * the client context on the floor had `null` on the left and `null` on the
 * right, the two agreed, and twenty tests stayed green against the exact fault
 * the suite exists to catch.
 *
 * The shape of that hazard on this side is different and the rule is the same.
 * Here the stub is both store and server, so a stub that dropped a field on write
 * would agree with a promise read back out of it. Promising from the literal
 * breaks the symmetry, and it was confirmed by injection rather than assumed:
 * with the stub's `putSession` dropping `clientLabel`, the wire-shape test fails.
 *
 * ## One assertion in this suite is a statement about the stub
 *
 * `authenticate` asserts that the `ClientContext` the caller passed reaches the
 * session. A browser cannot make that true: the network decides the address and
 * the user agent decides the label, both are observed on the far side, and the
 * backend whitelists its login body so a client that tried to send either is
 * refused. `ApiRequest.client` therefore exists for this stub and a real
 * transport drops it. The assertion is honoured here and is **not** evidence
 * about production; `stubBackend.ts` says so where a reader will find it.
 */

/** The actor's address as the world is given it: a form the domain has to change. */
const ACTOR_EMAIL_AS_GIVEN = '  Ada@Example.TEST ';

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** A second one, for the account whose address is never proven. */
const OTHER_PLAINTEXT = 'an entirely different long phrase';

/** A third, for the tests that need a replacement distinguishable from both. */
const REPLACEMENT_PLAINTEXT = 'yet another perfectly fine phrase';

/** One that breaks `DEFAULT_PASSWORD_POLICY`'s minimum length. */
const TOO_SHORT_PLAINTEXT = 'short';

/**
 * What this world says it could tell about the client its session was opened
 * from.
 *
 * It is the value the world **asked for**, in the same spirit as
 * `actorEmailAsGiven`, and it is the right-hand side of the wire-shape test's
 * two client comparisons. A value read back out of the store instead would move
 * with whatever the store did, which is the failure mode this constant exists to
 * rule out.
 */
const HARNESS_CLIENT: ClientContext = { address: '203.0.113.9', label: 'conformance' };

/** One instant for the accounts, which nothing in this suite compares. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** How long before now the world's own session began. */
const SESSION_AGE_MS = 60 * 1000;

/** How long the world's own session runs for. */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One account, as the wire carries it.
 *
 * @param id - the identifier this store would have given it
 * @param email - the address as the world was given it
 * @param displayName - the name shown to other people
 * @param verified - whether the address has been proven
 * @returns the wire shape to seed
 */
function seedUser(
  id: string,
  email: string,
  displayName: string,
  verified: boolean,
): UserJSON {
  return {
    id: id as UserId,
    email,
    displayName,
    status: UserStatus.ACTIVE,
    platformRole: PlatformRole.PLATFORM_USER,
    emailVerifiedAt: verified ? SEEDED_AT : null,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    deletedAt: null,
  };
}

/**
 * One session the world holds, opened in the recent past.
 *
 * It predates anything a test creates, which two assertions depend on: the
 * world's session must be strictly older than `Date.now()`, and it must sort
 * below a session opened during the test. A session created in the same
 * millisecond as the assertion fails the first intermittently and decides the
 * second on a tie-break rather than on the clock.
 *
 * @param id - the identifier this store would have given it
 * @param userId - whose session it is
 * @param openedAt - when it began
 * @returns the wire shape to seed and to promise from
 */
function seedSession(id: string, userId: UserId, openedAt: Date): SessionJSON {
  return {
    id: id as SessionId,
    userId,
    createdAt: openedAt.toISOString(),
    lastUsedAt: openedAt.toISOString(),
    expiresAt: new Date(openedAt.getTime() + SESSION_LIFETIME_MS).toISOString(),
    revokedAt: null,
    clientAddress: HARNESS_CLIENT.address,
    clientLabel: HARNESS_CLIENT.label,
  };
}

runIAuthServiceContract({
  describe,
  it,
  expect: adaptVitestToConformanceExpect(),
  // Well-formed for this store — ids here are `stub-<Thing>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentSessionId: 'stub-Session-absent' as SessionId,
  makeContext: async () => {
    // Once per context, not once per request: every test here writes through the
    // service and reads back through it, and two worlds would make the second
    // call miss what the first did.
    const backend = stubBackend();
    const openedAt = new Date(Date.now() - SESSION_AGE_MS);

    const actorId = 'stub-User-1' as UserId;
    const otherUserId = 'stub-User-2' as UserId;
    const pendingId = 'stub-User-3' as UserId;
    const pendingEmail = 'pending@example.test';

    backend.putUser(seedUser(String(actorId), ACTOR_EMAIL_AS_GIVEN, 'Ada', true), PLAINTEXT);
    backend.putUser(seedUser(String(otherUserId), 'grace@example.test', 'Grace', true), PLAINTEXT);
    backend.putUser(seedUser(String(pendingId), pendingEmail, 'Pending', false), OTHER_PLAINTEXT);

    const actorSession = seedSession('stub-Session-1', actorId, openedAt);
    backend.putSession(actorSession);
    const otherSession = seedSession('stub-Session-2', otherUserId, openedAt);
    backend.putSession(otherSession);

    // Two verification credentials for the pending account, one of them aged
    // out. The suite says out loud that the expired one is the single promise it
    // cannot check — `ExpiredTokenError` is deliberately also what an *unknown*
    // credential raises — so this one is really issued, with the same store and
    // the same shape as the live one and only the instant moved.
    const live = 'seeded-verification-live';
    const lapsed = 'seeded-verification-lapsed';
    backend.putVerification(pendingId, live, new Date(Date.now() + 24 * 60 * 60 * 1000));
    backend.putVerification(pendingId, lapsed, new Date(Date.now() - 60 * 60 * 1000));

    return {
      service: new AuthHttpService(backend.client),

      actorId,
      actorEmailAsGiven: ACTOR_EMAIL_AS_GIVEN,
      actorSecret: PLAINTEXT,
      // From this file's literals and through core's own entity — never read
      // back out of the stub. See this file's header.
      actorSession: Session.fromJSON(actorSession),

      otherUserId,
      otherUserSessionId: otherSession.id,

      pendingEmail,
      pendingSecret: OTHER_PLAINTEXT,
      pendingVerification: live,
      expiredVerification: lapsed,

      unknownEmail: 'nobody@example.test',
      weakSecret: TOO_SHORT_PLAINTEXT,
      replacementSecret: REPLACEMENT_PLAINTEXT,
    };
  },
});
