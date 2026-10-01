import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import {
  currentCodeFor,
  makeMfaWorld,
  type MfaWorld,
  type SeededMfaUser,
} from '../../common/testing';
import { buildBuckets } from '../../throttling/throttling.config';

/**
 * `POST /mfa/webauthn/verify` as a signed-in enrollment, which is where the
 * proof that admits a second passkey is guessed.
 *
 * ## The property
 *
 * The budget on that proof must belong to the **account**, not to the
 * credential the request happens to carry. A budget keyed on the access
 * credential resets whenever a new one is issued, and a session that is not the
 * owner's can obtain a new one on demand — so a cap that a token refresh resets
 * is not a cap on guessing. Two different credentials for one account must draw
 * on one allowance.
 *
 * Driven through the real route, bucket, subject and limit over a store that
 * counts; only the store is replaced (`meteredThrottling`).
 */
const ATTEMPTS_ALLOWED = buildBuckets(new ConfigService({}))['mfa-attempt'].limit;

class CountingStorage implements ThrottlerStorage {
  private readonly hits = new Map<string, number>();

  public async increment(
    key: string,
    _ttl: number,
    limit: number,
    blockDuration: number,
  ): ReturnType<ThrottlerStorage['increment']> {
    const hits = (this.hits.get(key) ?? 0) + 1;
    const blocked = hits > limit;
    this.hits.set(key, Math.min(hits, limit + 1));
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(blockDuration / 1000),
      isBlocked: blocked,
      timeToBlockExpire: blocked ? Math.ceil(blockDuration / 1000) : 0,
    };
  }
}

describe('the budget on a signed-in passkey enrollment', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld({ throttling: new CountingStorage() });
  });

  afterEach(async () => {
    await world.close();
  });

  const STEP_MS = 30_000;

  /** A full two-phase sign-in with the code of the step at `offset`, giving a fresh access credential. */
  async function signIn(user: SeededMfaUser, offset: number): Promise<string> {
    const login = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, secret: user.secret })
      .expect(200);
    const verified = await request(world.app.getHttpServer())
      .post('/auth/mfa/verify')
      .send({
        challengeToken: login.body.challengeToken,
        methodId: user.methodId,
        code: currentCodeFor(user.totpSecret, new Date(Date.now() + offset * STEP_MS)),
      })
      .expect(200);
    return verified.body.accessToken as string;
  }

  const enrol = (token: string): request.Test =>
    request(world.app.getHttpServer())
      .post('/mfa/webauthn/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({ response: { id: 'x' }, label: 'Key' });

  it('is one allowance for the account, however many credentials it is spent through', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const first = await signIn(user, -1);
    const second = await signIn(user, 1);
    expect(second).not.toBe(first);

    // The account holds a confirmed method and no proof is sent: each is refused
    // 403, and each counts.
    for (let attempt = 0; attempt < ATTEMPTS_ALLOWED; attempt += 1) {
      await enrol(first).expect(403);
    }

    // A different credential for the same account is not a fresh allowance.
    const refused = await enrol(second).expect(429);
    expect(refused.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('is a budget per account, not one shared by everybody', async () => {
    const owner = await world.seedUserWithConfirmedTotp();
    const bystander = await world.seedUserWithConfirmedTotp();
    const ownerToken = await signIn(owner, -1);
    const bystanderToken = await signIn(bystander, -1);

    for (let attempt = 0; attempt < ATTEMPTS_ALLOWED; attempt += 1) {
      await enrol(ownerToken).expect(403);
    }
    await enrol(ownerToken).expect(429);

    // Somebody else's allowance is untouched.
    await enrol(bystanderToken).expect(403);
  });
});
