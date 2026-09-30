import { randomUUID } from 'node:crypto';
import { runIMfaServiceContract } from '__FORGE_SCOPE__/core/mfa/testing';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import {
  adaptJestToConformanceExpect,
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
} from '../../common/testing';

/**
 * `MfaService` against core's **shared** `IMfaService` suite.
 *
 * This is the suite's first run against the implementation that ships: until
 * `removeMethod` and `regenerateRecoveryCodes` existed on `MfaService` it could
 * only be driven against core's in-memory reference. The sibling
 * `mfa.security.conformance.spec.ts` drives the server-only half; the split is
 * DEC-1 (`libs/core/CLAUDE.md`; the README's "A contract has two suites" row).
 *
 * ## The world
 *
 * Two accounts with nothing enrolled. The suite builds every method it needs
 * through the contract itself, so the `MfaService` under test is the real one,
 * over the real `TotpVerifier`, `RecoveryCodes` and `MfaVerificationService`, in
 * front of `FakeDataSource` — whose numbered limits are on that class.
 *
 * `validCodeFor` is a code for the current step, and confirming a method spends
 * it. That is why the shared suite proves removal and regeneration with
 * **recovery codes** and never with a code from a method it has just confirmed:
 * that code is already used, and presenting it again is refused, correctly.
 * Assertions that need a live code are the security suite's.
 */
const worlds: MfaWorld[] = [];

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()));
});

runIMfaServiceContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  makeContext: async () => {
    const world = await makeMfaWorld();
    worlds.push(world);

    const actor = await world.seedUserWithoutMfa();
    const other = await world.seedUserWithoutMfa();

    return {
      service: world.mfa,
      actorId: actor.userId,
      otherUserId: other.userId,
      validCodeFor: (offer) => currentCodeFor(offer.secret),
      // A well-formed id for a `uuid` column that no world contains.
      absentMethodId: randomUUID() as MfaMethodId,
    };
  },
});
