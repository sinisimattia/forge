import {
  MfaReauthenticationRequiredError,
  MfaVerificationFailedError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { MfaMethodId, MfaProof } from '__FORGE_SCOPE__/core/mfa/types';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import {
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededMfaUser,
} from '../../common/testing';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { RECOVERY_CODE_COUNT } from '../recovery/recovery-codes';

/**
 * `MfaService.confirmTotpEnrollment`, called directly, for the rule that a
 * factor is admitted only by a factor the account already holds.
 *
 * ## The property
 *
 * Enrollment asks for nothing but a live session, so without this rule a
 * stolen session could enrol a second factor of its own, confirm it, and then
 * remove the owner's — permitted, because a confirmed method survives. The
 * account would still have a second factor, and it would belong to the
 * attacker. Confirming a method therefore costs a fresh proof of a method
 * the account **already trusts**.
 *
 * ## The first factor is free, and that is half of the property
 *
 * An account with no confirmed method has nothing to prove with. Demanding a
 * proof there would not be a stricter rule, it would be an account that can
 * never enrol anything. `confirms the first factor with no proof` is the control
 * that stops every refusal below being satisfied by a service that simply
 * refuses everyone.
 *
 * `FakeDataSource` queues transactions on a locked row but does not model
 * Postgres's isolation (its items 1 and 2), so `refuses the second of two
 * overlapping first confirmations` shows the decision is re-made under the lock,
 * not what Postgres would do.
 */
describe('MfaService.confirmTotpEnrollment', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const STEP_MS = 30_000;

  const rowOf = (methodId: string): MfaMethodRecord | undefined =>
    (world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[])
      .find((row) => row.id === methodId);

  const confirmedCount = (userId: string): number =>
    (world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[])
      .filter((row) => row.userId === userId && row.confirmedAt !== null).length;

  const addedEntries = (): AuditEntryRecord[] =>
    (world.source.all(AuditEntryRecord) as unknown as AuditEntryRecord[])
      .filter((entry) => entry.action === AuditAction.MFA_METHOD_ADDED);

  /** The proof an already-enrolled person holds: a live code from their one confirmed method. */
  const proofFrom = (user: SeededMfaUser, at: Date = new Date()): MfaProof => ({
    methodId: user.methodId as MfaMethodId,
    code: currentCodeFor(user.totpSecret, at),
  });

  /**
   * A code the verifier accepts at none of the steps its window covers — never a
   * fixed literal, which is a valid code once in a third of a million.
   */
  function wrongCodeFor(secret: string): string {
    const now = Date.now();
    const valid = new Set(
      [-STEP_MS, 0, STEP_MS].map((offset) => currentCodeFor(secret, new Date(now + offset))),
    );
    for (let candidate = 0; candidate < 1_000_000; candidate += 1) {
      const code = String(candidate).padStart(6, '0');
      if (!valid.has(code)) return code;
    }
    throw new Error('unreachable: a million candidates cannot all be valid');
  }

  /** A method that has been offered and not yet confirmed, and the code its app would show. */
  async function offered(user: { userId: SeededMfaUser['userId'] }): Promise<{
    methodId: MfaMethodId;
    code: string;
  }> {
    const offer = await world.mfa.beginTotpEnrollment(user.userId, 'Phone');
    return { methodId: offer.methodId, code: currentCodeFor(offer.secret) };
  }

  it('confirms the first factor with no proof', async () => {
    const account = await world.seedUserWithoutMfa();
    const first = await offered(account);

    const batch = await world.mfa.confirmTotpEnrollment(
      account.userId,
      first.methodId,
      first.code,
      null,
    );

    expect(batch?.codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(rowOf(first.methodId)?.confirmedAt).toBeInstanceOf(Date);
  });

  it('is not made to prove anything by an abandoned, unconfirmed enrollment beside it', async () => {
    const account = await world.seedUserWithoutMfa();
    await offered(account);
    const real = await offered(account);

    await expect(
      world.mfa.confirmTotpEnrollment(account.userId, real.methodId, real.code, null),
    ).resolves.toBeDefined();
  });

  it('refuses a second factor without a proof, and leaves it unconfirmed', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const second = await offered(owner);

    await expect(
      world.mfa.confirmTotpEnrollment(owner.userId, second.methodId, second.code, null),
    ).rejects.toBeInstanceOf(MfaReauthenticationRequiredError);

    expect(rowOf(second.methodId)?.confirmedAt).toBeNull();
    expect(rowOf(second.methodId)?.totpLastStep).toBeNull();
    expect(confirmedCount(owner.userId)).toBe(1);
    expect(addedEntries()).toHaveLength(0);
  });

  it('confirms a second factor when a proof from the first accompanies it, and issues no new codes', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const second = await offered(owner);

    const batch = await world.mfa.confirmTotpEnrollment(
      owner.userId,
      second.methodId,
      second.code,
      proofFrom(owner),
    );

    expect(batch).toBeNull();
    expect(confirmedCount(owner.userId)).toBe(2);
  });

  it('accepts one of the account\'s recovery codes as the proof', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const codes = await world.recoveryCodes.generate(owner.userId);
    const second = await offered(owner);

    await world.mfa.confirmTotpEnrollment(owner.userId, second.methodId, second.code, {
      recoveryCode: codes[0],
    });

    expect(confirmedCount(owner.userId)).toBe(2);
  });

  it('refuses a proof that does not verify', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const second = await offered(owner);

    await expect(
      world.mfa.confirmTotpEnrollment(owner.userId, second.methodId, second.code, {
        recoveryCode: 'not-one-of-the-codes',
      }),
    ).rejects.toBeInstanceOf(MfaVerificationFailedError);

    expect(confirmedCount(owner.userId)).toBe(1);
  });

  it('refuses a proof from another account\'s method, valid code and all', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const attacker = await world.seedUserWithConfirmedTotp();
    const second = await offered(owner);

    await expect(
      world.mfa.confirmTotpEnrollment(
        owner.userId,
        second.methodId,
        second.code,
        proofFrom(attacker),
      ),
    ).rejects.toBeInstanceOf(MfaVerificationFailedError);

    expect(confirmedCount(owner.userId)).toBe(1);
  });

  it('does not spend the proof when the new method\'s own code is wrong', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const offer = await world.mfa.beginTotpEnrollment(owner.userId, 'Phone');
    const second = { methodId: offer.methodId, code: currentCodeFor(offer.secret) };
    // The next step: valid for the seeded method, and not yet spent by anything.
    const proof = proofFrom(owner, new Date(Date.now() + STEP_MS));

    await expect(
      world.mfa.confirmTotpEnrollment(
        owner.userId,
        second.methodId,
        wrongCodeFor(offer.secret),
        proof,
      ),
    ).rejects.toBeInstanceOf(MfaVerificationFailedError);

    // The same proof still works: it was never presented to the verifier.
    await world.mfa.confirmTotpEnrollment(owner.userId, second.methodId, second.code, proof);
    expect(confirmedCount(owner.userId)).toBe(2);
  });

  // The escalation this rule closes, end to end.
  it('stops a session adding a factor of its own and then removing the owner\'s', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const attackers = await offered(owner);

    await expect(
      world.mfa.confirmTotpEnrollment(owner.userId, attackers.methodId, attackers.code, null),
    ).rejects.toBeInstanceOf(MfaReauthenticationRequiredError);

    // With the attacker's factor unconfirmed, the owner's is the last confirmed
    // one, so removing it still costs a proof the session does not have.
    await expect(
      world.mfa.removeMethod(owner.userId, owner.methodId as MfaMethodId, null),
    ).rejects.toBeInstanceOf(MfaReauthenticationRequiredError);
    expect(rowOf(owner.methodId)).toBeDefined();
  });

  it('refuses the second of two overlapping first confirmations', async () => {
    const account = await world.seedUserWithoutMfa();
    const a = await offered(account);
    const b = await offered(account);

    // Both read an account with no confirmed method and so both are owed
    // nothing; only the decision re-made under the account's row lock sees that
    // the other has since been confirmed.
    const settled = await Promise.allSettled([
      world.mfa.confirmTotpEnrollment(account.userId, a.methodId, a.code, null),
      world.mfa.confirmTotpEnrollment(account.userId, b.methodId, b.code, null),
    ]);

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = settled.filter((outcome) => outcome.status === 'rejected');
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason)
      .toBeInstanceOf(MfaReauthenticationRequiredError);
    expect(confirmedCount(account.userId)).toBe(1);
  });
});
