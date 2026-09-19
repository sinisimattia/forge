import { runIAuthServiceContract } from '__FORGE_SCOPE__/core/auth/testing';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { adaptJestToConformanceExpect, makeIdentityWorld, HARNESS_CLIENT } from '../../common/testing';
import { generateOpaqueToken } from '../../common/crypto';
import { EmailVerificationTokenRecord } from '../entities/email-verification-token-record.entity';

/**
 * `AuthService` against core's **shared** `IAuthService` suite.
 *
 * A gate; it produces nothing. See `users.conformance.spec.ts` for what driving
 * a shared suite from a real implementation establishes (D3). The backend-only
 * security suite is driven next door, in `auth.security.conformance.spec.ts`.
 *
 * ## The order the world is built in is load-bearing
 *
 * The actor signs in **first**, before the other two accounts exist, and that is
 * not tidiness. Two assertions in the suite compare the world's session against
 * one the test creates:
 *
 * - `actorSession.createdAt.getTime() < Date.now()` — strictly less, so a world
 *   whose session was created in the same millisecond as the assertion fails
 *   intermittently.
 * - `listed[0]` must be the fresh session and `listed[1]` the world's, and
 *   `SessionService.listActive` orders by `created_at DESC, id DESC`. Two
 *   sessions sharing an instant fall through to the id tie-break, where this
 *   store's ids are strings — `fake-SessionRecord-10` sorts *below*
 *   `fake-SessionRecord-2` — and the test would fail on a lexicographic
 *   accident rather than on the implementation.
 *
 * Building the other two accounts after the sign-in puts two argon2 derivations
 * (tens of milliseconds apiece) between the world's session and anything the
 * suite does, which makes both comparisons decided by the clock rather than by a
 * race. It costs nothing and removes a class of flake this project has already
 * paid for once.
 *
 * ## The one credential that is written rather than issued
 *
 * `expiredVerification` is a verification credential whose lifetime has run out,
 * and `AuthService` offers no way to produce one — `sendVerification` always
 * dates the row 24 hours out. It is therefore inserted directly, with a real
 * opaque token so the hash the service looks up is the hash of a value that was
 * really generated.
 *
 * The suite says out loud that this is the one promise it cannot check:
 * `ExpiredTokenError` is deliberately also what an *unknown* credential raises,
 * so a host that supplied a value nobody ever issued would pass. The row below
 * is issued — same shape, same user, same hash function, only the instant moved
 * — which is the most this side can do about a promise the other side cannot
 * verify.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** A second one, for the account whose address is never proven. */
const OTHER_PLAINTEXT = 'an entirely different long phrase';

/** A third, for the tests that need a replacement distinguishable from both. */
const REPLACEMENT_PLAINTEXT = 'yet another perfectly fine phrase';

/** One that breaks `DEFAULT_PASSWORD_POLICY`'s minimum length. */
const TOO_SHORT_PLAINTEXT = 'short';

/** The actor's address as the world is given it: a form the domain has to change. */
const ACTOR_EMAIL_AS_GIVEN = '  Ada@Example.COM ';

runIAuthServiceContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  // Well-formed for this store — ids here are `fake-<Entity>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentSessionId: 'fake-SessionRecord-absent' as SessionId,
  makeContext: async () => {
    const world = makeIdentityWorld();

    const actorId = await world.registerAndVerify(ACTOR_EMAIL_AS_GIVEN, 'Ada', PLAINTEXT);
    // First, so everything below ages it. See the note above.
    const actorCredentials = await world.sessions.begin(actorId, HARNESS_CLIENT);

    const otherUserId = await world.registerAndVerify('grace@example.test', 'Grace', PLAINTEXT);
    const otherCredentials = await world.sessions.begin(otherUserId, HARNESS_CLIENT);

    const pendingEmail = 'pending@example.test';
    const pending = await world.registerOnly(pendingEmail, 'Pending', OTHER_PLAINTEXT);

    const expired = generateOpaqueToken();
    const past = new Date(Date.now() - 60 * 60 * 1000);
    world.source.seed(EmailVerificationTokenRecord, [{
      id: 'fake-EmailVerificationTokenRecord-expired',
      userId: pending.userId,
      tokenHash: expired.hash,
      expiresAt: past,
      consumedAt: null,
      createdAt: past,
    }]);

    return {
      service: world.auth,

      actorId,
      actorEmailAsGiven: ACTOR_EMAIL_AS_GIVEN,
      actorSecret: PLAINTEXT,
      // Read back out of the store rather than taken from what `begin` returned.
      // The suite compares the service's answer against this entity field by
      // field, so a value the service itself produced on both sides would be the
      // round trip the suite's own comment warns about.
      actorSession: world.sessionEntity(actorCredentials.session.id),

      otherUserId,
      otherUserSessionId: otherCredentials.session.id,

      pendingEmail,
      pendingSecret: OTHER_PLAINTEXT,
      pendingVerification: pending.verification,
      expiredVerification: expired.token,

      unknownEmail: 'nobody@example.test',
      weakSecret: TOO_SHORT_PLAINTEXT,
      replacementSecret: REPLACEMENT_PLAINTEXT,
    };
  },
});
