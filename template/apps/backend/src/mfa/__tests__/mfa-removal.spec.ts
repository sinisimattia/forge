import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import {
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededMfaUser,
} from '../../common/testing';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { MfaRecoveryCodeRecord } from '../entities/mfa-recovery-code-record.entity';
import { RECOVERY_CODE_COUNT } from '../recovery/recovery-codes';
import { generateTotpSecret } from '../totp/totp-authenticator';

/**
 * `DELETE /mfa/:id` and `POST /mfa/recovery-codes`, in front of the real
 * `MfaService`, `MfaVerificationService` and `RecoveryCodes`.
 *
 * ## The property
 *
 * A session that has been hijacked must not be able to strip the factor that
 * defeats it. Taking off the last confirmed method turns the second factor off,
 * so it takes a live proof of the second factor — not the password — and
 * regenerating recovery codes takes the same, because a fresh batch invalidates
 * the one the rightful owner is holding.
 *
 * ## Time
 *
 * A code is good for one step, and a sign-in spends the step it used. Every
 * account here signs in with the code from the step **before** the current one
 * (`signInCode`), leaving the current step (`currentCode`) and the next
 * (`nextCode`) unspent: those are the codes a proof can then use. Presenting
 * `signInCode` again is the replay a hijacker who watched the sign-in would try.
 *
 * ## What `FakeDataSource` cannot see
 *
 * Its class TSDoc, items 1 and 2. It queues transactions that lock the same row,
 * so the overlapping-call tests can fail without the lock — each was run with the
 * lock removed and went red — but it does not isolate a transaction's writes from
 * a concurrent reader, so they are not evidence about what Postgres does under
 * READ COMMITTED. `lockedRows` is what asserts the service asks for the lock.
 */
describe('mfa removal and recovery-code regeneration', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    signInCodes.clear();
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const STEP_MS = 30_000;
  /** The code for the step before this one — the one a session signs in with. */
  /**
   * Computed once per account and remembered. The stale-code tests present the
   * very code that signed the session in; recomputed at the point of use, a
   * clock that crossed a step boundary in between would make it a different,
   * live, code and the test would fail for a reason that has nothing to do
   * with what it asserts.
   */
  const signInCodes = new Map<string, string>();
  const signInCode = (user: SeededMfaUser): string => {
    const known = signInCodes.get(user.userId);
    if (known !== undefined) return known;
    const code = currentCodeFor(user.totpSecret, new Date(Date.now() - STEP_MS));
    signInCodes.set(user.userId, code);
    return code;
  };
  const currentCode = (user: SeededMfaUser): string => currentCodeFor(user.totpSecret);
  const nextCode = (user: SeededMfaUser): string =>
    currentCodeFor(user.totpSecret, new Date(Date.now() + STEP_MS));

  const bearer = (token: string): string => `Bearer ${token}`;

  /** A full two-phase sign-in, spending the previous step's code. */
  async function signIn(user: SeededMfaUser): Promise<string> {
    const login = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, secret: user.secret })
      .expect(200);
    const verified = await request(world.app.getHttpServer())
      .post('/auth/mfa/verify')
      .send({
        challengeToken: login.body.challengeToken,
        methodId: user.methodId,
        code: signInCode(user),
      })
      .expect(200);
    return verified.body.accessToken as string;
  }

  const remove = (token: string, methodId: string, proof?: object): request.Test =>
    request(world.app.getHttpServer())
      .delete(`/mfa/${methodId}`)
      .set('Authorization', bearer(token))
      .send(proof ?? {});

  const regenerate = (token: string, proof: object): request.Test =>
    request(world.app.getHttpServer())
      .post('/mfa/recovery-codes')
      .set('Authorization', bearer(token))
      .send(proof);

  const confirmedCount = (userId: string): number =>
    (world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[]).filter(
      (row) => row.userId === userId && row.confirmedAt !== null,
    ).length;

  const hasMethod = (methodId: string): boolean =>
    (world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[]).some(
      (row) => row.id === methodId,
    );

  /** The recovery-code rows that have been spent. */
  const spentCodes = (): MfaRecoveryCodeRecord[] =>
    (world.source.all(MfaRecoveryCodeRecord) as unknown as MfaRecoveryCodeRecord[]).filter(
      (row) => row.consumedAt !== null,
    );

  /** Adds a second confirmed method to an account, as a row. */
  function addConfirmedMethod(user: SeededMfaUser): string {
    const inserted = world.source.insert(MfaMethodRecord, {
      id: randomUUID(),
      userId: user.userId,
      type: MfaMethodType.TOTP,
      label: 'Second phone',
      totpSecret: user.totpSecret,
      totpLastStep: null,
      webauthnCredentialId: null,
      webauthnPublicKey: null,
      webauthnCounter: null,
      confirmedAt: new Date(),
      lastUsedAt: null,
      createdAt: new Date(Date.now() + 1),
    });
    return inserted.identifiers[0].id as string;
  }

  /** An unconfirmed method: an enrollment somebody started and never finished. */
  function addUnconfirmedMethod(user: SeededMfaUser): string {
    const inserted = world.source.insert(MfaMethodRecord, {
      id: randomUUID(),
      userId: user.userId,
      type: MfaMethodType.TOTP,
      label: 'Never finished',
      totpSecret: generateTotpSecret(),
      totpLastStep: null,
      webauthnCredentialId: null,
      webauthnPublicKey: null,
      webauthnCounter: null,
      confirmedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    });
    return inserted.identifiers[0].id as string;
  }

  describe('DELETE /mfa/:id', () => {
    it('removes a method when another confirmed one remains, on the session alone', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const second = addConfirmedMethod(user);

      await remove(token, user.methodId).expect(204);

      expect(hasMethod(user.methodId)).toBe(false);
      expect(hasMethod(second)).toBe(true);
    });

    it('removes an unconfirmed method on the session alone, even beside a lone confirmed one', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const abandoned = addUnconfirmedMethod(user);

      await remove(token, abandoned).expect(204);

      expect(hasMethod(abandoned)).toBe(false);
      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('refuses to remove the last confirmed method without a live proof', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      const refused = await remove(token, user.methodId).expect(403);

      expect(refused.body.code).toBe('MFA_REAUTHENTICATION_REQUIRED');
      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('removes the last confirmed method when a live proof accompanies it', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      await remove(token, user.methodId, {
        methodId: user.methodId,
        code: currentCode(user),
      }).expect(204);

      expect(confirmedCount(user.userId)).toBe(0);
    });

    // The OAuth-only account's only option: it has no password to present.
    it('accepts a recovery code as the proof, once', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const [code] = await world.recoveryCodes.generate(user.userId);
      const second = addConfirmedMethod(user);

      // Not owed while a second method stands: the code must not be spent by it.
      await remove(token, second, { recoveryCode: code }).expect(204);
      expect(spentCodes()).toHaveLength(0);

      await remove(token, user.methodId, { recoveryCode: code }).expect(204);
      expect(confirmedCount(user.userId)).toBe(0);
      expect(spentCodes()).toHaveLength(1);
    });

    // A hijacked session must not be able to strip the factor that defeats it.
    it('refuses a proof that is a stale TOTP code', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      // The code that signed this very session in — the one a hijacker who
      // watched the sign-in would have — is a spent step, not a live proof.
      const refused = await remove(token, user.methodId, {
        methodId: user.methodId,
        code: signInCode(user),
      }).expect(422);

      expect(refused.body.code).toBe('MFA_VERIFICATION_FAILED');
      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('refuses a live code presented a second time', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const code = currentCode(user);

      await regenerate(token, { methodId: user.methodId, code }).expect(200);
      await remove(token, user.methodId, { methodId: user.methodId, code }).expect(422);

      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('refuses a code that is simply wrong', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const live = new Set([currentCode(user), nextCode(user), signInCode(user)]);
      const wrong = ['000000', '111111', '222222'].find((candidate) => !live.has(candidate));

      await remove(token, user.methodId, { methodId: user.methodId, code: wrong }).expect(422);

      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('refuses a proof naming another account\'s method, valid code and all', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const victim = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      const refused = await remove(token, user.methodId, {
        methodId: victim.methodId,
        code: currentCode(victim),
      }).expect(422);

      expect(refused.body.code).toBe('MFA_VERIFICATION_FAILED');
      expect(confirmedCount(user.userId)).toBe(1);
      expect(confirmedCount(victim.userId)).toBe(1);
    });

    it('does not count an unconfirmed method\'s code as a proof', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const abandoned = addUnconfirmedMethod(user);
      // A row this test can compute a code for.
      world.source.update(MfaMethodRecord, { id: abandoned }, { totpSecret: user.totpSecret });

      await remove(token, user.methodId, {
        methodId: abandoned,
        code: currentCode(user),
      }).expect(422);

      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('answers a method that is somebody else\'s exactly as one that does not exist', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const victim = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      const foreign = await remove(token, victim.methodId).expect(404);
      const missing = await remove(token, randomUUID()).expect(404);
      const malformed = await remove(token, 'not-a-uuid').expect(404);

      expect(foreign.body).toEqual(missing.body);
      expect(malformed.body).toEqual(missing.body);
      expect(confirmedCount(victim.userId)).toBe(1);
    });

    it('refuses a body that offers two kinds of proof, or half of one', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      await remove(token, user.methodId, {
        methodId: user.methodId,
        code: currentCode(user),
        recoveryCode: 'anything',
      }).expect(400);
      await remove(token, user.methodId, { methodId: user.methodId }).expect(400);

      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('needs a session', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      await request(world.app.getHttpServer()).delete(`/mfa/${user.methodId}`).expect(401);
      expect(confirmedCount(user.userId)).toBe(1);
    });

    it('takes the account row lock, so two removals of the last two methods take turns', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const second = addConfirmedMethod(user);
      world.source.lockedRows.length = 0;

      const [first, other] = await Promise.all([
        remove(token, user.methodId),
        remove(token, second),
      ]);

      // Exactly one goes through on the session alone; the other is now removing
      // the last confirmed method and is asked for a proof. Without the lock each
      // counts the other as the survivor and both are allowed.
      expect([first.status, other.status].sort()).toEqual([204, 403]);
      expect(confirmedCount(user.userId)).toBe(1);
      expect(world.source.lockedRows).toContain(`UserRecord:${user.userId}`);
    });
  });

  describe('POST /mfa/recovery-codes', () => {
    it('requires a proof to regenerate recovery codes', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const [before] = await world.recoveryCodes.generate(user.userId);

      const refused = await regenerate(token, {}).expect(403);

      expect(refused.body.code).toBe('MFA_REAUTHENTICATION_REQUIRED');
      // Nothing changed: the code the owner holds still stands.
      expect(world.source.all(MfaRecoveryCodeRecord)).toHaveLength(RECOVERY_CODE_COUNT);
      expect(before).toEqual(expect.any(String));
    });

    it('replaces the batch on a live proof, and the codes it replaced stop working', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const [old] = await world.recoveryCodes.generate(user.userId);

      const issued = await regenerate(token, {
        methodId: user.methodId,
        code: currentCode(user),
      }).expect(200);

      expect(issued.headers['cache-control']).toBe('no-store');
      expect(issued.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(world.source.all(MfaRecoveryCodeRecord)).toHaveLength(RECOVERY_CODE_COUNT);
      await regenerate(token, { recoveryCode: old }).expect(422);
      // ...and a code from the new batch is a proof.
      await regenerate(token, { recoveryCode: issued.body.recoveryCodes[0] }).expect(200);
    });

    it('refuses a stale code', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      await world.recoveryCodes.generate(user.userId);

      await regenerate(token, { methodId: user.methodId, code: signInCode(user) }).expect(422);

      expect(world.source.all(MfaRecoveryCodeRecord)).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('leaves exactly one batch when two regenerations overlap', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const [first, second] = await world.recoveryCodes.generate(user.userId);
      world.source.lockedRows.length = 0;

      // Two proofs that are each good: two different recovery codes.
      const [a, b] = await Promise.all([
        regenerate(token, { recoveryCode: first }),
        regenerate(token, { recoveryCode: second }),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      // Twenty is what two unlocked delete-then-insert passes leave behind.
      expect(world.source.all(MfaRecoveryCodeRecord)).toHaveLength(RECOVERY_CODE_COUNT);
      expect(world.source.lockedRows).toContain(`UserRecord:${user.userId}`);
    });

    it('needs a session', async () => {
      await request(world.app.getHttpServer()).post('/mfa/recovery-codes').send({}).expect(401);
    });
  });
});
