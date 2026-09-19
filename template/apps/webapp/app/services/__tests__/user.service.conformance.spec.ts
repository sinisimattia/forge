import { describe, it } from 'vitest';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { runIUserServiceContract } from '__FORGE_SCOPE__/core/users/testing';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { UserHttpService } from '~/services/user.service';
import { adaptVitestToConformanceExpect } from '~/test/adapt-vitest';
import { stubBackend } from './stubBackend';

/**
 * `UserHttpService` against core's shared `IUserService` suite — the same suite
 * the backend's `UsersService` is driven through, under a different runner.
 *
 * A gate; it produces nothing. What it establishes is the half of DEC-1 that no
 * backend test can reach: that the implementation on *this* side of the wire
 * builds the entities the contract promises and raises the errors it names. The
 * other half — that the backend really answers this way — is that side's own
 * conformance run, and `stubBackend.ts` says so at length.
 *
 * ## Where the expectations come from
 *
 * Every value the suite compares against is built in **this file**, from a
 * literal, through core's own entity. Nothing is read back out of the stub and
 * nothing is obtained by calling the service under test. That rule is not
 * decoration: a host is free to build the `actor` it promises by calling the
 * service it is testing, nothing in the suite can stop it, and doing so makes
 * every comparison a value against itself — unfailable, and silently so. The
 * suite's own comment on the normalization test says this at length.
 *
 * The address the world is seeded from is deliberately not in normal form, which
 * is what makes an implementation that hands back a stored row rather than
 * rebuilding an entity visible in a field the suite reads.
 */

/** The actor's address as the world is given it: a form the domain has to change. */
const ACTOR_EMAIL_AS_GIVEN = '  Ada@Example.TEST ';

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** One instant for the whole world, so nothing depends on the order of seeding. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/**
 * One ordinary account, as the wire carries it.
 *
 * @param id - the identifier this store would have given it
 * @param email - the address as the world was given it
 * @param displayName - the name shown to other people
 * @param platformRole - the standing the account has
 * @returns the wire shape to seed and to promise from
 */
function seed(
  id: string,
  email: string,
  displayName: string,
  platformRole: PlatformRole,
): UserJSON {
  return {
    id: id as UserId,
    email,
    displayName,
    status: UserStatus.ACTIVE,
    platformRole,
    emailVerifiedAt: SEEDED_AT,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    deletedAt: null,
  };
}

runIUserServiceContract({
  describe,
  it,
  expect: adaptVitestToConformanceExpect(),
  // Well-formed for this store — ids here are `stub-<Thing>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentId: 'stub-User-absent' as UserId,
  makeContext: async () => {
    // **Once per context, not once per request.** The world behind this client
    // has to survive the several calls one test makes, or a value written by the
    // first is missing from the second and the failure reads as a service bug.
    const backend = stubBackend();

    const actor = seed('stub-User-1', ACTOR_EMAIL_AS_GIVEN, 'Ada', PlatformRole.PLATFORM_USER);
    const other = seed('stub-User-2', 'grace@example.test', 'Grace', PlatformRole.PLATFORM_USER);
    const admin = seed('stub-User-3', 'root@example.test', 'Root', PlatformRole.PLATFORM_ADMIN);
    backend.putUser(actor, PLAINTEXT);
    backend.putUser(other, PLAINTEXT);
    backend.putUser(admin, PLAINTEXT);

    return {
      service: new UserHttpService(backend.client),
      actor: User.fromJSON(actor),
      actorEmailAsGiven: ACTOR_EMAIL_AS_GIVEN,
      other: User.fromJSON(other),
      admin: User.fromJSON(admin),
    };
  },
});
