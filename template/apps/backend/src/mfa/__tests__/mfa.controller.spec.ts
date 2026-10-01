import request from 'supertest';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import {
  MFA_ISSUER,
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededAccount,
} from '../../common/testing';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { MfaRecoveryCodeRecord } from '../entities/mfa-recovery-code-record.entity';
import { MAX_MFA_METHODS } from '../mfa-limits';
import { RECOVERY_CODE_COUNT } from '../recovery/recovery-codes';

/**
 * `POST /mfa/totp/enroll`, `POST /mfa/totp/confirm` and `GET /mfa/methods`, in
 * front of the real `MfaService`, the real `TotpVerifier`, the real
 * `RecoveryCodes` and the real sign-in path — `makeMfaWorld` assembles them
 * with `GLOBAL_PROVIDERS` itself, so statuses and bodies are the application's.
 *
 * ## The property this file exists to pin
 *
 * An enrolled-but-unconfirmed method must not gate a sign-in. Somebody who
 * starts an enrollment and closes the tab has proven nothing; if the
 * half-finished row made their next login demand a factor they cannot supply,
 * an enrollment they never completed would lock them out of their own account.
 * The policy is pinned in core (`decideAuthenticationStep` counts confirmed
 * methods only); `does not make login two-phase until the method is confirmed`
 * pins the wiring: enrol, log in, get a session. Its sibling, `makes login
 * two-phase once the method is confirmed`, is the control that makes the first
 * able to fail — without it, a sign-in path that had stopped gating on anything
 * would satisfy both.
 *
 * ## What `FakeDataSource` cannot see, and which assertions lean on it
 *
 * Read the numbered list on the class. Three items touch this file:
 *
 * - **Column types (item 5).** `totpLastStep` is a `bigint`, which Postgres
 *   returns as a string; the double stores whatever it is given. The assertion
 *   that confirmation records the step reads it back through `Number(...)`, so
 *   it holds for either representation, and it is evidence the service writes
 *   *a* step, not that the column round-trips.
 * - **No isolation or blocking between requests (items 1 and 2).**
 *   Two confirmations racing on one method are decided in production by the
 *   affected-row count of `UPDATE … WHERE confirmed_at IS NULL`. Nothing here
 *   runs two at once, so `refuses to confirm a method that is already
 *   confirmed` asserts the sequential refusal only and is not evidence about the
 *   race.
 * - **Foreign keys (item 7).** `beginTotpEnrollment` refuses a user with no row
 *   itself, which is testable here; that the column also has a foreign key is
 *   not, and nothing below claims it.
 */
describe('MfaController', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  /** Signs in with the first factor alone; only valid for an account with no confirmed method. */
  async function accessTokenOf(account: SeededAccount): Promise<string> {
    const login = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: account.email, secret: account.secret })
      .expect(200);
    return login.body.accessToken as string;
  }

  const bearer = (token: string): string => `Bearer ${token}`;

  function enroll(token: string, label = 'Phone'): request.Test {
    return request(world.app.getHttpServer())
      .post('/mfa/totp/enroll')
      .set('Authorization', bearer(token))
      .send({ label });
  }

  function confirm(
    token: string,
    methodId: string,
    code: string,
    proof?: object,
  ): request.Test {
    return request(world.app.getHttpServer())
      .post('/mfa/totp/confirm')
      .set('Authorization', bearer(token))
      .send(proof === undefined ? { methodId, code } : { methodId, code, proof });
  }

  /**
   * A six-digit code that is **not** accepted for `secret` at any step the
   * verifier's window covers — never a fixed `'000000'`, which is a valid code
   * once in a third of a million, and a wrong-code test that is sometimes right
   * is one that fails for no reason a person can find.
   */
  function wrongCodeFor(secret: string): string {
    const now = Date.now();
    const valid = new Set(
      [-30_000, 0, 30_000].map((offset) => currentCodeFor(secret, new Date(now + offset))),
    );
    for (let candidate = 0; candidate < 1_000_000; candidate += 1) {
      const code = String(candidate).padStart(6, '0');
      if (!valid.has(code)) return code;
    }
    throw new Error('unreachable: a million candidates cannot all be valid');
  }

  const rowOf = (methodId: string): MfaMethodRecord | undefined => {
    const rows = world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[];
    return rows.find((row) => row.id === methodId);
  };

  describe('POST /mfa/totp/enroll', () => {
    it('enrolls an unconfirmed method and returns a scannable offer', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);

      const offer = await enroll(token).expect(201);

      expect(offer.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(offer.body.qrSvg).toContain('<svg');
      const row = rowOf(offer.body.methodId);
      expect(row).toBeDefined();
      expect(row?.confirmedAt).toBeNull();
      expect(row?.userId).toBe(account.userId);
      expect(row?.label).toBe('Phone');
    });

    it('refuses with a 409 and its own code once the account holds the most it may', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      for (let i = 0; i < MAX_MFA_METHODS; i += 1) await enroll(token, `k${i}`).expect(201);

      const refused = await enroll(token, 'one too many').expect(409);

      expect(refused.body.code).toBe('MFA_TOO_MANY_METHODS');
    });

    it('offers the secret it stored, in a URI whose issuer comes from configuration', async () => {
      const account = await world.seedUserWithoutMfa();
      const offer = await enroll(await accessTokenOf(account)).expect(201);

      // The secret a person scans must be the one the verifier will check
      // against. A URI and a row built from two different draws would enroll
      // an app that could never produce an accepted code.
      expect(rowOf(offer.body.methodId)?.totpSecret).toBe(offer.body.secret);

      const uri = new URL(offer.body.otpauthUri);
      expect(uri.searchParams.get('secret')).toBe(offer.body.secret);
      expect(uri.searchParams.get('issuer')).toBe(MFA_ISSUER);
      expect(decodeURIComponent(uri.pathname)).toBe(`/${MFA_ISSUER}:${account.email}`);
      // 32 Base32 characters is 20 bytes.
      expect(offer.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    });

    it('answers with a shared secret only to a client told not to keep it', async () => {
      const account = await world.seedUserWithoutMfa();
      const offer = await enroll(await accessTokenOf(account)).expect(201);
      expect(offer.headers['cache-control']).toBe('no-store');
    });

    it('offers a different secret to every enrollment', async () => {
      const token = await accessTokenOf(await world.seedUserWithoutMfa());
      const first = await enroll(token, 'One').expect(201);
      const second = await enroll(token, 'Two').expect(201);
      expect(first.body.secret).not.toBe(second.body.secret);
      expect(first.body.methodId).not.toBe(second.body.methodId);
    });

    it('refuses a label that is only whitespace, and stores nothing', async () => {
      const token = await accessTokenOf(await world.seedUserWithoutMfa());

      const refused = await enroll(token, '   ').expect(422);

      expect(refused.body.code).toBe('MFA_LABEL_REQUIRED');
      expect(world.source.all(MfaMethodRecord)).toHaveLength(0);
    });

    it('refuses a missing label at validation', async () => {
      const token = await accessTokenOf(await world.seedUserWithoutMfa());
      await request(world.app.getHttpServer())
        .post('/mfa/totp/enroll')
        .set('Authorization', bearer(token))
        .send({})
        .expect(400);
    });
  });

  describe('an unconfirmed method and signing in', () => {
    // The property that stops an abandoned enrollment becoming a lockout, at
    // the transport level this time. `decideAuthenticationStep` pinned the
    // policy; this pins the wiring.
    it('does not make login two-phase until the method is confirmed', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);

      // Not vacuous: the row this assertion is about exists, and is unconfirmed.
      expect(rowOf(offer.body.methodId)?.confirmedAt).toBeNull();

      const login = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, secret: account.secret })
        .expect(200);

      expect(login.body.accessToken).toEqual(expect.any(String));
      expect(login.body.challengeToken).toBeUndefined();
    });

    it('makes login two-phase once the method is confirmed', async () => {
      const account = await world.seedUserWithoutMfa();
      const offer = await enroll(await accessTokenOf(account)).expect(201);
      await confirm(
        await accessTokenOf(account),
        offer.body.methodId,
        currentCodeFor(offer.body.secret),
      ).expect(200);

      const login = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, secret: account.secret })
        .expect(200);

      expect(login.body.status).toBe(AuthenticationStatus.MFA_REQUIRED);
      expect(login.body.accessToken).toBeUndefined();
      expect(login.body.methods.map((method: { id: string }) => method.id)).toEqual([
        offer.body.methodId,
      ]);
    });
  });

  describe('POST /mfa/totp/confirm', () => {
    it('confirms with a correct code and returns the first batch of recovery codes', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);

      const confirmed = await confirm(
        token,
        offer.body.methodId,
        currentCodeFor(offer.body.secret),
      ).expect(200);

      expect(confirmed.headers['cache-control']).toBe('no-store');
      expect(confirmed.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
      const row = rowOf(offer.body.methodId);
      expect(row?.confirmedAt).toBeInstanceOf(Date);
      expect(Number(row?.totpLastStep)).toBeGreaterThan(0);
    });

    it('refuses a wrong code, and leaves the method unconfirmed and no codes issued', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);

      const refused = await confirm(
        token,
        offer.body.methodId,
        wrongCodeFor(offer.body.secret),
      ).expect(422);

      expect(refused.body.code).toBe('MFA_VERIFICATION_FAILED');
      expect(rowOf(offer.body.methodId)?.confirmedAt).toBeNull();
      expect(rowOf(offer.body.methodId)?.totpLastStep).toBeNull();
      expect(world.source.all(MfaRecoveryCodeRecord)).toHaveLength(0);
      // And the person can still sign in: a mistyped code is not a lockout.
      await accessTokenOf(account);
    });

    it('leaves the method unconfirmed when the recovery batch cannot be written', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);
      const code = currentCodeFor(offer.body.secret);

      // A batch that cannot be stored must take the confirmation down with it:
      // a method confirmed with no codes issued is a second factor on the account
      // and no way back in from a lost phone.
      const insert = world.source.insert.bind(world.source);
      const failing = jest.spyOn(world.source, 'insert').mockImplementation((entity, ...rest) => {
        if (entity === MfaRecoveryCodeRecord) throw new Error('recovery batch insert failed');
        return insert(entity, ...rest);
      });
      try {
        await confirm(token, offer.body.methodId, code).expect(500);
      } finally {
        failing.mockRestore();
      }

      const row = rowOf(offer.body.methodId);
      expect(row?.confirmedAt).toBeNull();
      expect(row?.totpLastStep).toBeNull();
      expect(world.source.all(MfaRecoveryCodeRecord)).toHaveLength(0);
      // Nothing was spent, so the same code, tried again, succeeds and brings its batch.
      const retried = await confirm(token, offer.body.methodId, code).expect(200);
      expect(retried.body.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
    });

    it('asks for the account row lock, so two confirmations for one account take turns', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);
      world.source.lockedRows.length = 0;

      await confirm(token, offer.body.methodId, currentCodeFor(offer.body.secret)).expect(200);

      // Evidence the service asks, not that Postgres serialises: see the class
      // TSDoc of `FakeDataSource`, item 1.
      expect(world.source.lockedRows).toContain(`UserRecord:${account.userId}`);
    });

    it('issues recovery codes that really sign somebody in, once', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);
      const confirmed = await confirm(
        token,
        offer.body.methodId,
        currentCodeFor(offer.body.secret),
      ).expect(200);
      const [code] = confirmed.body.recoveryCodes as string[];

      const challenge = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, secret: account.secret })
        .expect(200);
      const signedIn = await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({ challengeToken: challenge.body.challengeToken, recoveryCode: code })
        .expect(200);
      expect(signedIn.body.accessToken).toEqual(expect.any(String));

      const again = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, secret: account.secret })
        .expect(200);
      await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({ challengeToken: again.body.challengeToken, recoveryCode: code })
        .expect(401);
    });

    it('spends the confirming code: the same code cannot then complete a sign-in', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);
      const code = currentCodeFor(offer.body.secret);
      await confirm(token, offer.body.methodId, code).expect(200);

      const challenge = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, secret: account.secret })
        .expect(200);

      await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: challenge.body.challengeToken,
          methodId: offer.body.methodId,
          code,
        })
        .expect(401);
    });

    it('returns no recovery codes for a second method, and leaves the first batch alone', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const first = await enroll(token, 'One').expect(201);
      const firstBatch = await confirm(
        token,
        first.body.methodId,
        currentCodeFor(first.body.secret),
      ).expect(200);
      const batchBefore = world.source
        .all(MfaRecoveryCodeRecord)
        .map((row) => row.codeHash)
        .sort();

      // The account now has a confirmed method, so its token is the one from
      // before the confirmation: a session is not re-issued by enrolling. Adding
      // a second factor costs a proof of the first; one of the codes just issued
      // is the proof any person holding that batch has.
      const second = await enroll(token, 'Two').expect(201);
      const confirmed = await confirm(
        token,
        second.body.methodId,
        currentCodeFor(second.body.secret),
        { recoveryCode: firstBatch.body.recoveryCodes[0] },
      ).expect(200);

      expect(confirmed.body.recoveryCodes).toBeNull();
      expect(
        world.source
          .all(MfaRecoveryCodeRecord)
          .map((row) => row.codeHash)
          .sort(),
      ).toEqual(batchBefore);
    });

    it('refuses to confirm a method that is already confirmed', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);
      const code = currentCodeFor(offer.body.secret);
      await confirm(token, offer.body.methodId, code).expect(200);

      const again = await confirm(token, offer.body.methodId, code).expect(409);

      expect(again.body.code).toBe('MFA_METHOD_ALREADY_CONFIRMED');
    });

    it('answers a method that is not theirs, does not exist, or is not an id, identically', async () => {
      const victim = await world.seedUserWithoutMfa();
      const victimToken = await accessTokenOf(victim);
      const theirs = await enroll(victimToken).expect(201);

      const attacker = await world.seedUserWithoutMfa();
      const attackerToken = await accessTokenOf(attacker);
      // A code that is genuinely valid for the victim's method: the refusal must
      // be about whose method it is, not about a wrong code.
      const validForVictim = currentCodeFor(theirs.body.secret);

      const foreign = await confirm(
        attackerToken,
        theirs.body.methodId,
        validForVictim,
      ).expect(404);
      const absent = await confirm(
        attackerToken,
        '00000000-0000-4000-8000-000000000000',
        validForVictim,
      ).expect(404);
      const malformed = await confirm(attackerToken, 'not-an-id', validForVictim).expect(404);

      expect(foreign.body.code).toBe('MFA_METHOD_NOT_FOUND');
      // The messages name the id asked for, so they are compared as codes and
      // statuses; the body's shape must otherwise match.
      expect(absent.body.code).toBe(foreign.body.code);
      expect(malformed.body.code).toBe(foreign.body.code);
      expect(Object.keys(absent.body).sort()).toEqual(Object.keys(foreign.body).sort());
      expect(rowOf(theirs.body.methodId)?.confirmedAt).toBeNull();
    });
  });

  describe('GET /mfa/methods', () => {
    it('returns methods without any secret material', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const offer = await enroll(token).expect(201);
      await confirm(token, offer.body.methodId, currentCodeFor(offer.body.secret)).expect(200);
      const pending = await enroll(token, 'Tablet').expect(201);

      const listed = await request(world.app.getHttpServer())
        .get('/mfa/methods')
        .set('Authorization', bearer(token))
        .expect(200);

      const body = JSON.stringify(listed.body);
      expect(body).not.toContain(offer.body.secret);
      expect(body).not.toContain(pending.body.secret);
      expect(listed.body.methods).toHaveLength(2);
      for (const method of listed.body.methods) {
        expect(Object.keys(method).sort()).toEqual(
          ['confirmedAt', 'createdAt', 'id', 'label', 'lastUsedAt', 'type', 'userId'],
        );
      }
    });

    it('returns a seeded method without its seed', async () => {
      const seeded = await world.seedUserWithConfirmedTotp();
      const login = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: seeded.email, secret: seeded.secret })
        .expect(200);
      const challenge = login.body.challengeToken as string;
      const verified = await request(world.app.getHttpServer())
        .post('/auth/mfa/verify')
        .send({
          challengeToken: challenge,
          methodId: seeded.methodId,
          code: currentCodeFor(seeded.totpSecret),
        })
        .expect(200);

      const listed = await request(world.app.getHttpServer())
        .get('/mfa/methods')
        .set('Authorization', bearer(verified.body.accessToken))
        .expect(200);

      expect(listed.body.methods).toHaveLength(1);
      expect(JSON.stringify(listed.body)).not.toContain(seeded.totpSecret);
    });

    it('lists confirmed and unconfirmed methods, and only the actor\'s own', async () => {
      const mine = await world.seedUserWithoutMfa();
      const theirs = await world.seedUserWithoutMfa();
      const myToken = await accessTokenOf(mine);
      const theirToken = await accessTokenOf(theirs);
      const pending = await enroll(myToken, 'Pending').expect(201);
      const elsewhere = await enroll(theirToken, 'Elsewhere').expect(201);

      const listed = await request(world.app.getHttpServer())
        .get('/mfa/methods')
        .set('Authorization', bearer(myToken))
        .expect(200);

      const ids = listed.body.methods.map((method: { id: string }) => method.id);
      expect(ids).toEqual([pending.body.methodId]);
      expect(ids).not.toContain(elsewhere.body.methodId);
      expect(listed.body.methods[0].confirmedAt).toBeNull();
    });

    /** The envelope's one key beside `methods`; see the tests below. */
    async function recoveryCodesRemainingFor(token: string): Promise<unknown> {
      const listed = await request(world.app.getHttpServer())
        .get('/mfa/methods')
        .set('Authorization', bearer(token))
        .expect(200);
      return listed.body.recoveryCodesRemaining;
    }

    it('reports how many unconsumed recovery codes remain', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);
      const codes = await world.recoveryCodes.generate(account.userId);
      expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
      expect(await recoveryCodesRemainingFor(token)).toBe(RECOVERY_CODE_COUNT);

      await world.recoveryCodes.consume(account.userId, codes[0]!);

      expect(await recoveryCodesRemainingFor(token)).toBe(RECOVERY_CODE_COUNT - 1);
    });

    it('reports zero rather than omitting the count', async () => {
      const account = await world.seedUserWithoutMfa();
      const token = await accessTokenOf(account);

      const listed = await request(world.app.getHttpServer())
        .get('/mfa/methods')
        .set('Authorization', bearer(token))
        .expect(200);

      // `toBe(0)` alone would also fail on a missing key, but the key's presence
      // is the property: a template cannot tell an absent field from a zero.
      expect(Object.keys(listed.body)).toContain('recoveryCodesRemaining');
      expect(listed.body.recoveryCodesRemaining).toBe(0);
    });

    it('reports zero once every code is spent, and counts only the actor\'s own', async () => {
      const mine = await world.seedUserWithoutMfa();
      const theirs = await world.seedUserWithoutMfa();
      const myToken = await accessTokenOf(mine);
      const myCodes = await world.recoveryCodes.generate(mine.userId);
      await world.recoveryCodes.generate(theirs.userId);
      for (const code of myCodes) await world.recoveryCodes.consume(mine.userId, code);

      expect(await recoveryCodesRemainingFor(myToken)).toBe(0);
    });
  });

  describe('authentication', () => {
    it.each([
      ['get', '/mfa/methods'],
      ['post', '/mfa/totp/enroll'],
      ['post', '/mfa/totp/confirm'],
    ] as const)('refuses %s %s without a session', async (verb, path) => {
      await request(world.app.getHttpServer())[verb](path).send({}).expect(401);
    });
  });
});
