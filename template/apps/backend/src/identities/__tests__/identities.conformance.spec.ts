import { runIIdentityServiceContract } from '__FORGE_SCOPE__/core/identities/testing';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { adaptJestToConformanceExpect, makeIdentityWorld } from '../../common/testing';
import { AuthIdentityRecord } from '../auth-identity-record.entity';

/**
 * `IdentitiesService` against core's shared `IIdentityService` suite.
 *
 * A gate; it produces nothing. See `users.conformance.spec.ts` for what driving
 * a shared suite from a real implementation establishes (D3).
 *
 * ## The world, and the one row that is written rather than driven
 *
 * The actor holds two identities because the suite needs one it can unlink
 * without meeting the last-identity rule. **Only one of them can be created
 * through the surface this suite drives**: `IdentitiesService` grows a password
 * identity at registration, and the only way it grows a federated one is
 * `createFederatedIdentityIn`, which takes an `EntityManager` and is called from
 * inside `OAuthService.complete`'s transaction, after a provider round-trip this
 * suite has no way to make. The second is therefore a seeded `GOOGLE` row.
 *
 * That is worth being uncomfortable about and is the right trade. The
 * alternative — giving the actor two accounts' worth of password identities —
 * cannot be built at all: the store enforces one password identity per user in
 * production (`IdentityFoundation1758000001000`'s unique index), and a world
 * that broke that rule would be asserting `unlinkIdentity` against a shape the
 * database refuses. A seeded row of a provider the enum already names is the
 * shape the feature will have when somebody writes it.
 *
 * Note what the seeded row means for `LastIdentityRemovalError`: the rule is
 * core's `assertAtLeastOneIdentityRemains` over the identities themselves, so it
 * does not care which provider wrote them, and the suite's second user — one
 * identity, created by registration alone — is where that error is actually
 * asserted.
 *
 * ## The normalization promise, weakened here in the same way as elsewhere
 *
 * The wire-shape test wants `passwordAccountIdAsGiven` to be a form the domain
 * has to change, so that an implementation returning its stored row differs
 * visibly from one that rebuilt the entity. `IdentitiesService.createPassword-
 * Identity` normalizes before the insert, so the stored column already holds the
 * normal form and that half is not reachable here — the same honest limit
 * `users.conformance.spec.ts` records at length, for the same reason, and with
 * the same refusal to fake a row this application cannot write. The precondition
 * the suite asserts still holds, and the rest of the comparison still bites.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** The actor's address as the world is given it: a form the domain has to change. */
const ACTOR_EMAIL_AS_GIVEN = '  Ada@Example.COM ';

runIIdentityServiceContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  // Well-formed for this store — ids here are `fake-<Entity>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentIdentityId: 'fake-AuthIdentityRecord-absent' as AuthIdentityId,
  makeContext: async () => {
    const world = makeIdentityWorld();

    const actorId = await world.registerAndVerify(ACTOR_EMAIL_AS_GIVEN, 'Ada', PLAINTEXT);
    const soleIdentityUserId = await world.registerAndVerify(
      'grace@example.test',
      'Grace',
      PLAINTEXT,
    );

    // The actor's second identity. Seeded with an explicit id, because
    // `FakeDataSource.seed` writes rows as given and assigns none — which is
    // what lets this row be named below without reading it back first.
    const federatedId = 'fake-AuthIdentityRecord-federated';
    world.source.seed(AuthIdentityRecord, [{
      id: federatedId,
      userId: actorId,
      provider: AuthProvider.GOOGLE,
      providerAccountId: 'google-subject-1',
      createdAt: new Date(),
      lastUsedAt: null,
      secretHash: null,
      secretAlgorithm: null,
      secretParams: null,
    }]);

    const actorRows = world.source
      .match(AuthIdentityRecord, { userId: actorId })
      .map((row) => world.identityEntity(row.id as AuthIdentityId));
    const soleRow = world.source.match(AuthIdentityRecord, { userId: soleIdentityUserId })[0];

    return {
      service: world.identities,
      actorId,
      actorIdentities: actorRows,
      passwordAccountIdAsGiven: ACTOR_EMAIL_AS_GIVEN,
      soleIdentityUserId,
      soleIdentityId: soleRow.id as AuthIdentityId,
    };
  },
});
