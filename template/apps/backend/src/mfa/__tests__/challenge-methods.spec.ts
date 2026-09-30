import request from 'supertest';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { makeMfaWorld, currentCodeFor } from '../../common/testing/mfa-world';
import type { MfaWorld, SeededMfaUser } from '../../common/testing/mfa-world';
import { UserRecord } from '../../users/user-record.entity';
import { MfaChallengeRecord } from '../entities/mfa-challenge-record.entity';
import { MfaChallengePurpose } from '../enums/MfaChallengePurpose';

/**
 * # `POST /auth/mfa/methods`
 *
 * The federated door's half of what `POST /auth/login` returns inline. A
 * redirect carries a challenge token and no body, and a code is presented with
 * the id of the method that produced it, so without this read a person who
 * signed in through a provider has no id to send.
 *
 * What is asserted is what would make the read worse than the login response
 * it stands in for: that it spends the challenge (ending the sign-in it was
 * asked about), that it returns more than the three fields, that it answers
 * for an account the challenge does not name, and that its refusals are told
 * apart — which would let tokens be probed without being presented.
 */
/** Of the right shape and naming nothing this world minted. */
const UNKNOWN_CHALLENGE = 'no-such-challenge';
const UNISSUED_RECOVERY = 'nothing';

describe('POST /auth/mfa/methods', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  const http = () => request(world.app.getHttpServer());

  async function challengeFor(
    account: SeededMfaUser,
  ): Promise<{ token: string; methods: unknown }> {
    const login = await http()
      .post('/auth/login')
      .send({ email: account.email, secret: account.secret })
      .expect(200);
    return { token: login.body.challengeToken as string, methods: login.body.methods };
  }

  it('answers exactly the list the password response carries: id, type, label', async () => {
    const account = await world.seedUserWithConfirmedTotp();
    const { token, methods } = await challengeFor(account);

    const listed = await http().post('/auth/mfa/methods').send({ challengeToken: token }).expect(200);

    expect(listed.body).toEqual({ methods });
    expect(listed.body.methods).toHaveLength(1);
    // Key sets, not values: a fourth field is the failure, and `toEqual` above
    // would already catch one, but this says why.
    expect(Object.keys(listed.body.methods[0]).sort()).toEqual(['id', 'label', 'type']);
    expect(listed.body.methods[0].id).toBe(account.methodId);
    expect(listed.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(listed.body)).not.toContain(account.totpSecret);
  });

  it('spends nothing: the same challenge still finishes the sign-in afterwards, twice listed', async () => {
    const account = await world.seedUserWithConfirmedTotp();
    const { token } = await challengeFor(account);

    await http().post('/auth/mfa/methods').send({ challengeToken: token }).expect(200);
    await http().post('/auth/mfa/methods').send({ challengeToken: token }).expect(200);

    const rows = world.source.all(MfaChallengeRecord) as unknown as MfaChallengeRecord[];
    expect(rows.every((row) => row.consumedAt === null)).toBe(true);
    await http()
      .post('/auth/mfa/verify')
      .send({
        challengeToken: token,
        methodId: account.methodId,
        code: currentCodeFor(account.totpSecret),
      })
      .expect(200);
  });

  it('lists the account the challenge names, and not another that has methods of its own', async () => {
    const mine = await world.seedUserWithConfirmedTotp('mine@example.test');
    const theirs = await world.seedUserWithConfirmedTotp('theirs@example.test');
    const { token } = await challengeFor(mine);

    const listed = await http().post('/auth/mfa/methods').send({ challengeToken: token }).expect(200);

    const ids = listed.body.methods.map((method: { id: string }) => method.id);
    expect(ids).toEqual([mine.methodId]);
    expect(ids).not.toContain(theirs.methodId);
  });

  it('does NOT list a method that was offered and never confirmed', async () => {
    const account = await world.seedUserWithConfirmedTotp();
    await world.mfa.beginTotpEnrollment(account.userId as UserId, 'Pending');
    const { token } = await challengeFor(account);

    const listed = await http().post('/auth/mfa/methods').send({ challengeToken: token }).expect(200);

    const ids = listed.body.methods.map((method: { id: string }) => method.id);
    expect(ids).toEqual([account.methodId]);
  });

  // The enumeration property. Each request below fails a different way, and the
  // last is the reference: what `POST /auth/mfa/verify` answers for a token that
  // answers to nothing.
  it('refuses five ways of being unpresentable with one answer, verify\'s own', async () => {
    const account = await world.seedUserWithConfirmedTotp();

    const expired = (await challengeFor(account)).token;
    world.source.update(MfaChallengeRecord, {}, { expiresAt: new Date(0) });

    const fresh = (await challengeFor(account)).token;
    const spent = (await challengeFor(account)).token;
    await http()
      .post('/auth/mfa/verify')
      .send({ challengeToken: spent, methodId: account.methodId, code: 'not-the-code' })
      .expect(401);

    const enrollment = await world.challenges.mint(
      account.userId as UserId,
      MfaChallengePurpose.WEBAUTHN_ENROLLMENT,
      'nonce',
    );

    // A live challenge whose account was suspended after it was minted. Minted
    // before the loop so that it is compared like the others, not asserted apart.
    const suspendedAccount = await world.seedUserWithConfirmedTotp('suspended@example.test');
    const suspended = (await challengeFor(suspendedAccount)).token;
    world.source.update(UserRecord, { id: suspendedAccount.userId }, { status: 'SUSPENDED' });

    const answers = [];
    for (const challengeToken of [UNKNOWN_CHALLENGE, expired, spent, enrollment, suspended]) {
      const answered = await http().post('/auth/mfa/methods').send({ challengeToken });
      answers.push({ status: answered.status, body: answered.text });
    }
    const reference = await http()
      .post('/auth/mfa/verify')
      .send({ challengeToken: UNKNOWN_CHALLENGE, recoveryCode: UNISSUED_RECOVERY });

    expect(reference.status).toBe(401);
    expect(answers).toHaveLength(5);
    for (const answer of answers) {
      expect(answer).toEqual({ status: 401, body: reference.text });
    }
    // The fresh one was never touched by any of them.
    await http().post('/auth/mfa/methods').send({ challengeToken: fresh }).expect(200);
  });

  it('answers a request with no token as it answers every malformed body, not as a refusal', async () => {
    const asked = await http().post('/auth/mfa/methods').send({});
    const reference = await http().post('/auth/mfa/verify').send({});

    expect(asked.status).toBe(reference.status);
    expect(asked.status).not.toBe(401);
  });
});
