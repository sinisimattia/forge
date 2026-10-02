import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Repository } from 'typeorm';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AuditEntryRecord } from '../../audit/audit-entry-record.entity';
import { UserRecord } from '../../users/user-record.entity';
import {
  FEDERATED_ADDRESS,
  currentCodeFor,
  previousStepCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededAccount,
  type SeededMfaUser,
} from '../../common/testing';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { RECOVERY_CODE_COUNT } from '../recovery/recovery-codes';

/**
 * What the second factor writes into the audit trail, through the real routes.
 *
 * Each case names the entry, the account it is recorded against, and what its
 * metadata may and may not hold. The entries are read back from the store the
 * services wrote them to, so a call that was removed, or made with the wrong
 * actor, fails here rather than passing on the strength of a stub.
 *
 * ## What is deliberately not recorded
 *
 * A challenge refused before an account can be named — absent, expired or
 * already spent — produces no entry, because the error carries no account and an
 * entry naming a guessed one would be false. `records nothing for a challenge
 * that names no account` pins that, so it is a decision on record rather than a
 * gap.
 */
describe('mfa audit trail', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const STEP_MS = 30_000;
  const bearer = (token: string): string => `Bearer ${token}`;

  /** Every entry of one action, oldest first. */
  const entriesOf = (action: AuditAction): AuditEntryRecord[] =>
    (world.source.all(AuditEntryRecord) as unknown as AuditEntryRecord[])
      .filter((row) => row.action === action);

  /** A six-digit code no step in the verifier's window accepts. */
  function wrongCodeFor(secret: string): string {
    const now = Date.now();
    const valid = new Set(
      [-2, -1, 0, 1, 2].map((step) => currentCodeFor(secret, new Date(now + step * STEP_MS))),
    );
    for (let candidate = 0; candidate < 1_000_000; candidate += 1) {
      const code = String(candidate).padStart(6, '0');
      if (!valid.has(code)) return code;
    }
    throw new Error('unreachable: a million candidates cannot all be valid');
  }

  /**
   * Asserts `reason` does not appear in a response body as a token of its own.
   *
   * Not `not.toContain(reason)`: the transport's message key for this refusal is
   * `mfa_verification_failed`, of which `verification_failed` is a substring, so
   * a plain containment check would fail against the *message* and pass or fail
   * for a reason that has nothing to do with the recorded reason leaking. The
   * lookarounds require that the reason is not part of a longer identifier.
   */
  function expectReasonNotReturned(body: unknown, reason: string): void {
    expect(JSON.stringify(body)).not.toMatch(tokenOf(reason));
  }

  const tokenOf = (reason: string): RegExp =>
    new RegExp(`(?<![a-z0-9_])${reason}(?![a-z0-9_])`, 'i');

  const login = (user: SeededAccount): request.Test =>
    request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, secret: user.secret });

  const verify = (body: object): request.Test =>
    request(world.app.getHttpServer()).post('/auth/mfa/verify').send(body);

  /** A full sign-in, spending the previous step's code so the current one stays free for a proof. */
  async function signIn(user: SeededMfaUser): Promise<string> {
    const started = await login(user).expect(200);
    const done = await verify({
      challengeToken: started.body.challengeToken,
      methodId: user.methodId,
      code: await previousStepCodeFor(user.totpSecret),
    }).expect(200);
    return done.body.accessToken as string;
  }

  describe('the first phase of a sign-in', () => {
    it('records the challenge a password sign-in was stopped with, and no login', async () => {
      const user = await world.seedUserWithConfirmedTotp();

      await login(user).expect(200);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_CHALLENGE_ISSUED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.resourceId).toBe(user.userId);
      // Issued is all it says: nothing was proven and no session exists.
      expect(entriesOf(AuditAction.LOGIN_SUCCEEDED)).toHaveLength(0);
      expect(entriesOf(AuditAction.MFA_CHALLENGE_SUCCEEDED)).toHaveLength(0);
      expect(world.sessionCount()).toBe(0);
    });

    it('records nothing of the kind for an account with no second factor', async () => {
      const account = await world.seedUserWithoutMfa();

      await login(account).expect(200);

      expect(entriesOf(AuditAction.MFA_CHALLENGE_ISSUED)).toHaveLength(0);
    });

    it('records the challenge a provider assertion was stopped with, though verify is never called', async () => {
      // No local credential was presented on this path, so this entry is the
      // only record the attempt happened.
      const user = await world.seedUserWithConfirmedTotp(FEDERATED_ADDRESS);
      world.linkFederatedIdentity(user.userId);
      const begin = await request(world.app.getHttpServer())
        .get(`/auth/oauth/${AuthProvider.OIDC}`)
        .expect(302);
      const target = new URL(begin.headers.location as string);

      await request(world.app.getHttpServer()).get(`${target.pathname}${target.search}`);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_CHALLENGE_ISSUED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entriesOf(AuditAction.LOGIN_SUCCEEDED)).toHaveLength(0);
      expect(entriesOf(AuditAction.MFA_CHALLENGE_FAILED)).toHaveLength(0);
    });
  });

  describe('the second phase of a sign-in', () => {
    it('records a second factor that held, against the account the challenge was minted for', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const started = await login(user).expect(200);

      await verify({
        challengeToken: started.body.challengeToken,
        methodId: user.methodId,
        code: currentCodeFor(user.totpSecret),
      }).expect(200);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_CHALLENGE_SUCCEEDED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.metadata).toMatchObject({ sessionId: expect.any(String) });
      expect(entriesOf(AuditAction.LOGIN_SUCCEEDED)).toHaveLength(1);
      expect(entriesOf(AuditAction.MFA_CHALLENGE_FAILED)).toHaveLength(0);
    });

    it('records a wrong code with the reason, and the caller is not told the reason', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const started = await login(user).expect(200);

      const refused = await verify({
        challengeToken: started.body.challengeToken,
        methodId: user.methodId,
        code: wrongCodeFor(user.totpSecret),
      }).expect(401);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_CHALLENGE_FAILED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.metadata).toEqual({ reason: 'verification_failed', proof: 'totp' });
      // Recorded and never returned.
      expectReasonNotReturned(refused.body, 'verification_failed');
      expect(entriesOf(AuditAction.MFA_CHALLENGE_SUCCEEDED)).toHaveLength(0);
      expect(world.sessionCount()).toBe(0);
    });

    it('records each guess, so guessing leaves a trail', async () => {
      const user = await world.seedUserWithConfirmedTotp();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const started = await login(user).expect(200);
        await verify({
          challengeToken: started.body.challengeToken,
          methodId: user.methodId,
          code: wrongCodeFor(user.totpSecret),
        }).expect(401);
      }

      expect(entriesOf(AuditAction.MFA_CHALLENGE_FAILED)).toHaveLength(3);
    });

    it('records a challenge whose account can no longer authenticate, with that reason', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const started = await login(user).expect(200);
      await (world.source.getRepository(UserRecord) as unknown as Repository<UserRecord>)
        .update({ id: user.userId }, { status: UserStatus.SUSPENDED });

      await verify({
        challengeToken: started.body.challengeToken,
        methodId: user.methodId,
        code: currentCodeFor(user.totpSecret),
      }).expect(401);

      const [entry] = entriesOf(AuditAction.MFA_CHALLENGE_FAILED);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.metadata).toEqual({ reason: 'account_unavailable' });
    });

    it('records a method that is not the account\'s, against the account whose challenge it was', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const other = await world.seedUserWithConfirmedTotp();
      const started = await login(user).expect(200);

      await verify({
        challengeToken: started.body.challengeToken,
        methodId: other.methodId,
        code: currentCodeFor(other.totpSecret),
      }).expect(401);

      const [entry] = entriesOf(AuditAction.MFA_CHALLENGE_FAILED);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.metadata).toEqual({ reason: 'method_not_found', proof: 'totp' });
    });

    it('returns none of the four recorded reasons, and the same body for each', async () => {
      // The needle discipline is checked first, so a needle that could never
      // match cannot make the assertions below pass for the wrong reason.
      expect(JSON.stringify({ code: 'mfa_verification_failed' })).not.toMatch(
        tokenOf('verification_failed'),
      );
      expect(JSON.stringify({ reason: 'verification_failed' })).toMatch(
        tokenOf('verification_failed'),
      );

      const bodies: Record<string, unknown> = {};

      // verification_failed: a wrong code.
      const guesser = await world.seedUserWithConfirmedTotp();
      const wrong = await verify({
        challengeToken: (await login(guesser).expect(200)).body.challengeToken,
        methodId: guesser.methodId,
        code: wrongCodeFor(guesser.totpSecret),
      }).expect(401);
      bodies.verification_failed = wrong.body;

      // method_not_found: somebody else's method.
      const other = await world.seedUserWithConfirmedTotp();
      const strayed = await verify({
        challengeToken: (await login(guesser).expect(200)).body.challengeToken,
        methodId: other.methodId,
        code: currentCodeFor(other.totpSecret),
      }).expect(401);
      bodies.method_not_found = strayed.body;

      // recovery_code_already_consumed: a code that was spent.
      const [code] = await world.recoveryCodes.generate(other.userId);
      await verify({
        challengeToken: (await login(other).expect(200)).body.challengeToken,
        recoveryCode: code,
      }).expect(200);
      const replayed = await verify({
        challengeToken: (await login(other).expect(200)).body.challengeToken,
        recoveryCode: code,
      }).expect(401);
      bodies.recovery_code_already_consumed = replayed.body;

      // account_unavailable: suspended between the two phases.
      const suspended = await world.seedUserWithConfirmedTotp();
      const token = (await login(suspended).expect(200)).body.challengeToken;
      await (world.source.getRepository(UserRecord) as unknown as Repository<UserRecord>)
        .update({ id: suspended.userId }, { status: UserStatus.SUSPENDED });
      const gone = await verify({
        challengeToken: token,
        methodId: suspended.methodId,
        code: currentCodeFor(suspended.totpSecret),
      }).expect(401);
      bodies.account_unavailable = gone.body;

      // All four were recorded, each under its own reason...
      const recorded = entriesOf(AuditAction.MFA_CHALLENGE_FAILED)
        .map((entry) => (entry.metadata as { reason: string }).reason);
      expect(recorded.sort()).toEqual(Object.keys(bodies).sort());

      // ...and none of them, nor any distinction between them, was returned.
      for (const [reason, body] of Object.entries(bodies)) {
        expectReasonNotReturned(body, reason);
        expect(body).toEqual(wrong.body);
      }
    });

    it('records nothing for a challenge that names no account', async () => {
      const nobodyIssued = ['no', 'body', 'was', 'issued', 'this'].join('-');
      await verify({
        challengeToken: nobodyIssued,
        methodId: '00000000-0000-4000-8000-000000000000',
        code: '123456',
      }).expect(401);

      expect(entriesOf(AuditAction.MFA_CHALLENGE_FAILED)).toHaveLength(0);
    });

    it('records a recovery code that signed somebody in, and the second factor it satisfied', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const [code] = await world.recoveryCodes.generate(user.userId);
      const started = await login(user).expect(200);

      await verify({ challengeToken: started.body.challengeToken, recoveryCode: code }).expect(200);

      const [spent] = entriesOf(AuditAction.RECOVERY_CODE_CONSUMED);
      expect(spent.actorUserId).toBe(user.userId);
      expect(JSON.stringify(spent)).not.toContain(code.replace(/\s+/g, ''));
      const [held] = entriesOf(AuditAction.MFA_CHALLENGE_SUCCEEDED);
      expect(held.actorUserId).toBe(user.userId);
      expect(held.metadata).toMatchObject({ proof: 'recovery_code' });
    });

    it('records the same refusals when the first factor was a provider assertion', async () => {
      // The federated door mints the same LOGIN challenge, so the second phase
      // is one route and one set of entries whichever way the first factor was
      // passed. This is the case where no local credential was ever presented.
      const user = await world.seedUserWithConfirmedTotp(FEDERATED_ADDRESS);
      world.linkFederatedIdentity(user.userId);
      const begin = await request(world.app.getHttpServer())
        .get(`/auth/oauth/${AuthProvider.OIDC}`)
        .expect(302);
      const target = new URL(begin.headers.location as string);
      const callback = await request(world.app.getHttpServer())
        .get(`${target.pathname}${target.search}`);
      const challengeToken = new URL(callback.headers.location as string)
        .searchParams.get('challengeToken');

      await verify({
        challengeToken,
        methodId: user.methodId,
        code: wrongCodeFor(user.totpSecret),
      }).expect(401);

      const [entry] = entriesOf(AuditAction.MFA_CHALLENGE_FAILED);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.metadata).toEqual({ reason: 'verification_failed', proof: 'totp' });
    });
  });

  /**
   * The passkey leg that sits between the two phases: it spends the login
   * challenge to fetch authentication options and mints a second one to carry
   * the ceremony nonce.
   *
   * It is a second-factor path that can be reached with no proof at all — a
   * challenge token is the whole of what it asks for — so what it records is
   * what stands between "somebody probed the passkey path" and silence.
   */
  describe('the passkey leg of a sign-in', () => {
    /**
     * A confirmed passkey, written as a row.
     *
     * `webauthn/__tests__/webauthn.spec.ts` seeds one the same way and for the
     * same reason: a case about what this leg *records* must not also be able
     * to fail because enrollment broke. Neither the credential id nor the
     * stored key is read by the leg under test — only their presence on a
     * confirmed row is.
     */
    function seedPasskey(userId: UserId): void {
      const now = new Date();
      world.source.insert(MfaMethodRecord, {
        // A real UUID: `mfa_methods.id` is a `uuid` column and the store's own
        // synthetic ids are not.
        id: randomUUID(),
        userId,
        type: MfaMethodType.WEBAUTHN,
        label: 'Security key',
        totpSecret: null,
        totpLastStep: null,
        webauthnCredentialId: 'Q3JlZGVudGlhbE9uZQ',
        webauthnPublicKey: Buffer.from([1, 2, 3]).toString('base64url'),
        webauthnCounter: '0',
        confirmedAt: now,
        lastUsedAt: null,
        createdAt: now,
      });
    }

    const options = (challengeToken: string): request.Test =>
      request(world.app.getHttpServer())
        .post('/mfa/webauthn/options')
        .send({ challengeToken });

    it('records the challenge it re-mints as issued, and nothing as proven', async () => {
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId);
      const started = await login(account).expect(200);

      await options(started.body.challengeToken as string).expect(200);

      // Two issuances against the one account: the password leg's, then this
      // leg's, which is the one carrying the ceremony.
      const issued = entriesOf(AuditAction.MFA_CHALLENGE_ISSUED);
      expect(issued).toHaveLength(2);
      expect(issued.map((entry) => entry.actorUserId)).toEqual([account.userId, account.userId]);
      expect(issued[0].metadata).toEqual({});
      expect(issued[1].metadata).toEqual({ proof: 'webauthn' });
      // Issued is all either of them says: no assertion has been offered.
      expect(entriesOf(AuditAction.MFA_CHALLENGE_SUCCEEDED)).toHaveLength(0);
      expect(entriesOf(AuditAction.MFA_CHALLENGE_FAILED)).toHaveLength(0);
      expect(world.sessionCount()).toBe(0);
    });

    it('records an account holding no passkey, and the caller is not told the reason', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const started = await login(user).expect(200);

      const refused = await options(started.body.challengeToken as string).expect(401);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_CHALLENGE_FAILED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.metadata).toEqual({ reason: 'verification_failed', proof: 'webauthn' });
      // Recorded and never returned, as on every other refusal in this feature.
      expectReasonNotReturned(refused.body, 'verification_failed');
      // Only the password leg's issuance: this leg refused before it minted.
      expect(entriesOf(AuditAction.MFA_CHALLENGE_ISSUED)).toHaveLength(1);
      expect(world.sessionCount()).toBe(0);
    });

    it('records nothing for a challenge that names no account', async () => {
      const nobodyIssued = ['no', 'body', 'was', 'issued', 'this'].join('-');

      await options(nobodyIssued).expect(401);

      expect(entriesOf(AuditAction.MFA_CHALLENGE_FAILED)).toHaveLength(0);
      expect(entriesOf(AuditAction.MFA_CHALLENGE_ISSUED)).toHaveLength(0);
    });

    it('refuses an account suspended inside the challenge window, and records that reason', async () => {
      // The sibling of `the second phase of a sign-in`'s case of the same name.
      // Spending a `LOGIN` challenge means re-reading the account, wherever the
      // spending happens: without that here, a suspension binds on the leg that
      // finishes the sign-in but not on the leg that hands out this account's
      // passkey credential ids and mints it a replacement challenge.
      const account = await world.seedUserWithoutMfa();
      seedPasskey(account.userId);
      const started = await login(account).expect(200);
      await (world.source.getRepository(UserRecord) as unknown as Repository<UserRecord>)
        .update({ id: account.userId }, { status: UserStatus.SUSPENDED });

      const refused = await options(started.body.challengeToken as string).expect(401);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_CHALLENGE_FAILED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(account.userId);
      expect(entry.metadata).toEqual({ reason: 'account_unavailable', proof: 'webauthn' });
      expectReasonNotReturned(refused.body, 'account_unavailable');
      // Nothing was handed out: no credential ids in the body, and only the
      // password leg's issuance — this leg refused before it minted.
      expect(refused.body.publicKey).toBeUndefined();
      expect(entriesOf(AuditAction.MFA_CHALLENGE_ISSUED)).toHaveLength(1);
      expect(world.sessionCount()).toBe(0);
    });
  });

  describe('enrollment', () => {
    const enroll = (token: string): request.Test =>
      request(world.app.getHttpServer())
        .post('/mfa/totp/enroll')
        .set('Authorization', bearer(token))
        .send({ label: 'Phone' });

    const confirm = (token: string, methodId: string, code: string): request.Test =>
      request(world.app.getHttpServer())
        .post('/mfa/totp/confirm')
        .set('Authorization', bearer(token))
        .send({ methodId, code });

    it('records a method when it is confirmed, and says the first codes came with it', async () => {
      const account = await world.seedUserWithoutMfa();
      const session = await login(account).expect(200);
      const offer = await enroll(session.body.accessToken).expect(201);

      // Beginning an enrollment is not an event: nothing gates on it yet.
      expect(entriesOf(AuditAction.MFA_METHOD_ADDED)).toHaveLength(0);

      await confirm(
        session.body.accessToken,
        offer.body.methodId,
        currentCodeFor(offer.body.secret),
      ).expect(200);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_METHOD_ADDED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(account.userId);
      expect(entry.resourceId).toBe(offer.body.methodId);
      expect(entry.metadata).toEqual({ methodType: MfaMethodType.TOTP, recoveryCodesIssued: true });
      // Not a regeneration: the first set is noted on the entry above.
      expect(entriesOf(AuditAction.RECOVERY_CODES_REGENERATED)).toHaveLength(0);
      // Neither the secret nor the code is written down.
      expect(JSON.stringify(entry)).not.toContain(offer.body.secret);
    });

    it('does not record a method whose code did not verify', async () => {
      const account = await world.seedUserWithoutMfa();
      const session = await login(account).expect(200);
      const offer = await enroll(session.body.accessToken).expect(201);

      await confirm(session.body.accessToken, offer.body.methodId, wrongCodeFor(offer.body.secret))
        .expect(422);

      expect(entriesOf(AuditAction.MFA_METHOD_ADDED)).toHaveLength(0);
    });
  });

  describe('removal and regeneration', () => {
    const remove = (token: string, methodId: string, proof: object = {}): request.Test =>
      request(world.app.getHttpServer())
        .delete(`/mfa/${methodId}`)
        .set('Authorization', bearer(token))
        .send(proof);

    const regenerate = (token: string, proof: object): request.Test =>
      request(world.app.getHttpServer())
        .post('/mfa/recovery-codes')
        .set('Authorization', bearer(token))
        .send(proof);

    it('records the removal of the last method, and that a proof accompanied it', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      await remove(token, user.methodId, {
        methodId: user.methodId,
        code: currentCodeFor(user.totpSecret),
      }).expect(204);

      const [entry, ...rest] = entriesOf(AuditAction.MFA_METHOD_REMOVED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.resourceId).toBe(user.methodId);
      expect(entry.metadata).toEqual({ methodType: MfaMethodType.TOTP, reauthenticated: true });
    });

    it('does not record discarding an enrollment that was never confirmed', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const abandoned = world.source.insert(MfaMethodRecord, {
        id: randomUUID(),
        userId: user.userId,
        type: MfaMethodType.TOTP,
        label: 'Never finished',
        totpSecret: user.totpSecret,
        totpLastStep: null,
        webauthnCredentialId: null,
        webauthnPublicKey: null,
        webauthnCounter: null,
        confirmedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      }).identifiers[0].id as string;

      await remove(token, abandoned).expect(204);

      // Never recorded as added, so its removal is not an event the trail can
      // describe; the method is nonetheless gone.
      expect(entriesOf(AuditAction.MFA_METHOD_REMOVED)).toHaveLength(0);
      expect((world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[])
        .some((row) => row.id === abandoned)).toBe(false);
    });

    it('does not record a removal that was refused', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      await remove(token, user.methodId).expect(403);

      expect(entriesOf(AuditAction.MFA_METHOD_REMOVED)).toHaveLength(0);
    });

    it('records a recovery code spent as the proof, against the account that spent it', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);
      const [code] = await world.recoveryCodes.generate(user.userId);

      await remove(token, user.methodId, { recoveryCode: code }).expect(204);

      const [entry, ...rest] = entriesOf(AuditAction.RECOVERY_CODE_CONSUMED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entriesOf(AuditAction.MFA_METHOD_REMOVED)).toHaveLength(1);
    });

    it('records regeneration, and never the codes', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      const issued = await regenerate(token, {
        methodId: user.methodId,
        code: currentCodeFor(user.totpSecret),
      }).expect(200);

      expect(issued.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      const [entry, ...rest] = entriesOf(AuditAction.RECOVERY_CODES_REGENERATED);
      expect(rest).toHaveLength(0);
      expect(entry.actorUserId).toBe(user.userId);
      expect(entry.metadata).toEqual({});
      for (const code of issued.body.recoveryCodes as string[]) {
        expect(JSON.stringify(entry)).not.toContain(code.replace(/\s+/g, ''));
      }
    });

    it('does not record regeneration that was refused', async () => {
      const user = await world.seedUserWithConfirmedTotp();
      const token = await signIn(user);

      await regenerate(token, {}).expect(403);

      expect(entriesOf(AuditAction.RECOVERY_CODES_REGENERATED)).toHaveLength(0);
    });
  });
});
