import request from 'supertest';
import {
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededMfaUser,
} from '../../common/testing';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';

/**
 * `POST /mfa/totp/confirm` for an account that already has a confirmed method:
 * the transport half of the rule `mfa.service.spec.ts` pins on the service.
 *
 * What only this level can show is the wire shape of the proof: it travels
 * under a `proof` property, because the confirm body's own `methodId` and `code`
 * name the method being *added*, and a refusal answers `403`
 * `MFA_REAUTHENTICATION_REQUIRED` — the answer the other proof-gated routes give.
 */
describe('POST /mfa/totp/confirm, for an account that already has a second factor', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const STEP_MS = 30_000;
  const bearer = (token: string): string => `Bearer ${token}`;

  /** A full two-phase sign-in, spending the previous step's code and leaving the current one for a proof. */
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
        code: currentCodeFor(user.totpSecret, new Date(Date.now() - STEP_MS)),
      })
      .expect(200);
    return verified.body.accessToken as string;
  }

  async function offer(token: string): Promise<{ methodId: string; code: string }> {
    const offered = await request(world.app.getHttpServer())
      .post('/mfa/totp/enroll')
      .set('Authorization', bearer(token))
      .send({ label: 'Phone' })
      .expect(201);
    return {
      methodId: offered.body.methodId as string,
      code: currentCodeFor(offered.body.secret as string),
    };
  }

  const confirm = (token: string, body: object): request.Test =>
    request(world.app.getHttpServer())
      .post('/mfa/totp/confirm')
      .set('Authorization', bearer(token))
      .send(body);

  const confirmedCount = (userId: string): number =>
    (world.source.all(MfaMethodRecord) as unknown as MfaMethodRecord[])
      .filter((row) => row.userId === userId && row.confirmedAt !== null).length;

  it('answers 403 MFA_REAUTHENTICATION_REQUIRED without a proof, and confirms nothing', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const token = await signIn(user);
    const second = await offer(token);

    const refused = await confirm(token, second).expect(403);

    expect(refused.body.code).toBe('MFA_REAUTHENTICATION_REQUIRED');
    expect(confirmedCount(user.userId)).toBe(1);
  });

  it('confirms when a proof from the existing method rides in `proof`', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const token = await signIn(user);
    const second = await offer(token);

    const confirmed = await confirm(token, {
      ...second,
      proof: { methodId: user.methodId, code: currentCodeFor(user.totpSecret) },
    }).expect(200);

    expect(confirmed.body.recoveryCodes).toBeNull();
    expect(confirmedCount(user.userId)).toBe(2);
  });

  it('answers 422 for a proof that does not verify, and confirms nothing', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const token = await signIn(user);
    const second = await offer(token);

    const refused = await confirm(token, { ...second, proof: { recoveryCode: 'not-a-code' } })
      .expect(422);

    expect(refused.body.code).toBe('MFA_VERIFICATION_FAILED');
    expect(confirmedCount(user.userId)).toBe(1);
  });

  it('refuses a proof that is half of one, as a malformed request', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const token = await signIn(user);
    const second = await offer(token);

    await confirm(token, { ...second, proof: { methodId: user.methodId } }).expect(400);

    expect(confirmedCount(user.userId)).toBe(1);
  });

  it('confirms an account\'s first factor with no proof', async () => {
    const account = await world.seedUserWithoutMfa();
    const login = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: account.email, secret: account.secret })
      .expect(200);
    const token = login.body.accessToken as string;
    const first = await offer(token);

    await confirm(token, first).expect(200);

    expect(confirmedCount(account.userId)).toBe(1);
  });
});
