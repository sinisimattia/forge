import { runIMfaServiceSecurityContract } from '__FORGE_SCOPE__/core/mfa/testing';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import {
  adaptJestToConformanceExpect,
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
} from '../../common/testing';
import { MfaRecoveryCodeRecord } from '../entities/mfa-recovery-code-record.entity';

/**
 * `MfaService` against core's **server-only** `IMfaService` suite.
 *
 * Driven here and nowhere else (DEC-1, in `libs/core/CLAUDE.md`; the README row
 * "A contract has two suites"). The world is one the contract cannot build for itself: the
 * actor's one confirmed method is **seeded as a row** with `totpLastStep` null,
 * so its current code has never been used for anything. Confirming a method
 * through the contract spends the code that confirmed it, so no caller could
 * present a live code to be accepted once and refused the second time.
 * `readStoredRecoveryCodeValues` reads the table directly, which is the other
 * thing no caller can do.
 */
const worlds: MfaWorld[] = [];

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()));
});

runIMfaServiceSecurityContract({
  describe,
  it,
  expect: adaptJestToConformanceExpect(),
  makeContext: async () => {
    const world = await makeMfaWorld();
    worlds.push(world);

    const actor = await world.seedUserWithConfirmedTotp();

    return {
      service: world.mfa,
      actorId: actor.userId,
      actorMethodId: actor.methodId as MfaMethodId,
      computeActorCode: () => currentCodeFor(actor.totpSecret),
      readStoredRecoveryCodeValues: async () =>
        (world.source.all(MfaRecoveryCodeRecord) as unknown as MfaRecoveryCodeRecord[])
          .filter((row) => row.userId === actor.userId)
          .map((row) => row.codeHash),
    };
  },
});
