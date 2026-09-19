import { runIUserServiceContract } from '__FORGE_SCOPE__/core/users/testing';
import { PlatformRole } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { adaptJestToConformanceExpect, makeIdentityWorld } from '../../common/testing';

/**
 * `UsersService` against core's shared `IUserService` suite.
 *
 * ## What this file is for
 *
 * It is a gate and it produces nothing. Its whole value is that the suite in
 * `libs/core/src/users/testing/` stops being satisfied only by the reference
 * implementation written beside it and starts being satisfied by an
 * implementation that reads a store, maps rows to entities and writes an audit
 * trail. That is D3, and it is worth saying plainly what it does and does not
 * establish: a contract a real implementation passes is a contract about
 * something; a contract only its own reference implementation passes is a
 * contract about that file.
 *
 * ## The world
 *
 * Three accounts, built by driving the real `AuthService.register` and
 * `AuthService.verifyEmail` — not by writing rows — so the world a suite is
 * handed exists by the same code path the application uses. The one thing no
 * caller can do, promoting somebody to platform administrator with no
 * administrator yet in the deployment, is done by writing the column, in the one
 * named helper (`IdentityWorld.patchUser`) that owns that.
 *
 * The right-hand side of every comparison is read back out of the store and
 * rebuilt as an entity by the world, never by `UsersService`. A promised world
 * read back through the implementation under test lets that implementation agree
 * with itself, which is the tautology the suite's own preamble warns about.
 *
 * ## One assertion this harness weakens, said out loud
 *
 * `getProfile` "returns the address in normal form, not the form the world was
 * given" is written for a store that holds the address as the world gave it —
 * mixed case, with whitespace — so an implementation handing back its row
 * differs visibly from an implementation that rebuilt the entity. **This backend
 * normalizes on write** (`AuthService.register` calls `normalizeEmail` before
 * the insert), so a world built through registration leaves the store holding
 * the normal form, and that particular failure mode is not reachable here. The
 * suite's precondition — that `actorEmailAsGiven` is not already normal — is
 * still honoured and still checked, and what remains failable is the rest: that
 * an entity comes back at all (`instanceof`), and that the ten fields of the
 * wire shape match the promised user.
 *
 * Seeding the raw form into the column would restore the missing half, and it is
 * deliberately not done: it would be asserting against a row shape this
 * application cannot produce, which is a test of a store nobody has.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/**
 * The actor's address as the world is given it: mixed case, with surrounding
 * whitespace, so `UserServiceContractContext.actorEmailAsGiven` is a form the
 * domain has to change. The suite asserts that before it leans on it.
 */
const ACTOR_EMAIL_AS_GIVEN = '  Ada@Example.COM ';

runIUserServiceContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  // Well-formed for this store — ids here are `fake-<Entity>-<n>` — and held by
  // no world this factory builds. The suite cannot invent one; see its deps.
  absentId: 'fake-UserRecord-absent' as UserId,
  makeContext: async () => {
    const world = makeIdentityWorld();

    const actorId = await world.registerAndVerify(ACTOR_EMAIL_AS_GIVEN, 'Ada', PLAINTEXT);
    const otherId = await world.registerAndVerify('grace@example.test', 'Grace', PLAINTEXT);
    const adminId = await world.registerAndVerify('root@example.test', 'Root', PLAINTEXT);

    // No caller of `IUserService` can create the first administrator — every
    // path to `setPlatformRole` already requires one. The column is written
    // directly, which is the ownership DEC-1 says a store-owning implementation
    // may use.
    world.patchUser(adminId, { platformRole: PlatformRole.PLATFORM_ADMIN });

    return {
      service: world.users,
      actor: world.userEntity(actorId),
      actorEmailAsGiven: ACTOR_EMAIL_AS_GIVEN,
      other: world.userEntity(otherId),
      admin: world.userEntity(adminId),
    };
  },
});
