import { describe, it } from 'vitest';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { runIIdentityServiceContract } from '__FORGE_SCOPE__/core/identities/testing';
import type { AuthIdentityId, AuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { IdentityHttpService } from '~/services/identity.service';
import { adaptVitestToConformanceExpect } from '~/test/adapt-vitest';
import { stubBackend } from './stubBackend';

/**
 * `IdentityHttpService` against core's shared `IIdentityService` suite — the
 * same suite the backend's `IdentitiesService` is driven through.
 *
 * A gate; it produces nothing. See `user.service.conformance.spec.ts` for what
 * driving a shared suite from this side establishes and for where the
 * expectations come from; the same rule holds here and for the same reason.
 *
 * ## The second user holds exactly one identity, and that is load-bearing
 *
 * `soleIdentityId` plays two parts. As its owner's only identity it is what
 * `LastIdentityRemovalError` is tested with; as an identity the *actor* does not
 * hold it is what the ownership tests run against. Give the second user a spare
 * and an implementation that checked the count before ownership would pass the
 * count check, fall through to ownership, answer not-found and go undetected.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** One instant for the whole world, so nothing depends on the order of seeding. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/**
 * The account identifier the password identity is built from: a form the domain
 * has to change, which is what makes the wire-shape assertion bite.
 */
const PASSWORD_ACCOUNT_ID_AS_GIVEN = '  Ada@Example.TEST ';

/**
 * One identity, as the wire carries it.
 *
 * @param id - the identifier this store would have given it
 * @param userId - whose identity it is
 * @param provider - which kind of proof it stands for
 * @param providerAccountId - the account identifier as the world was given it
 * @returns the wire shape to seed and to promise from
 */
function seed(
  id: string,
  userId: string,
  provider: AuthProvider,
  providerAccountId: string,
): AuthIdentityJSON {
  return {
    id: id as AuthIdentityId,
    userId: userId as UserId,
    provider,
    providerAccountId,
    createdAt: SEEDED_AT,
    lastUsedAt: null,
  };
}

runIIdentityServiceContract({
  describe,
  it,
  expect: adaptVitestToConformanceExpect(),
  // Well-formed for this store, and held by no world this factory builds.
  absentIdentityId: 'stub-AuthIdentity-absent' as AuthIdentityId,
  makeContext: async () => {
    // Once per context; see `user.service.conformance.spec.ts`.
    const backend = stubBackend();

    const actorId = 'stub-User-1' as UserId;
    const soleIdentityUserId = 'stub-User-2' as UserId;
    for (const [id, email, name] of [
      [actorId, 'ada@example.test', 'Ada'],
      [soleIdentityUserId, 'grace@example.test', 'Grace'],
    ] as const) {
      backend.putUser({
        id,
        email,
        displayName: name,
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.PLATFORM_USER,
        emailVerifiedAt: SEEDED_AT,
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
        deletedAt: null,
      }, PLAINTEXT);
    }

    const password = seed(
      'stub-AuthIdentity-1',
      actorId,
      AuthProvider.PASSWORD,
      PASSWORD_ACCOUNT_ID_AS_GIVEN,
    );
    // A second identity for the actor, so that one of them can be unlinked
    // without meeting the last-identity rule.
    const federated = seed(
      'stub-AuthIdentity-2',
      actorId,
      AuthProvider.GOOGLE,
      'ada@example.test',
    );
    const sole = seed(
      'stub-AuthIdentity-3',
      soleIdentityUserId,
      AuthProvider.PASSWORD,
      'grace@example.test',
    );
    backend.putIdentity(password);
    backend.putIdentity(federated);
    backend.putIdentity(sole);

    return {
      service: new IdentityHttpService(backend.client),
      actorId,
      // Built from this file's own literals, never read back out of the stub:
      // a promise assembled from what the world was written to hold is failable,
      // one assembled from what the world turned out to hold is not.
      actorIdentities: [AuthIdentity.fromJSON(password), AuthIdentity.fromJSON(federated)],
      passwordAccountIdAsGiven: PASSWORD_ACCOUNT_ID_AS_GIVEN,
      soleIdentityUserId,
      soleIdentityId: sole.id,
    };
  },
});
