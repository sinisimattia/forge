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
 * D16 — "a subject that exhausts its budget is refused, and the refusal is the
 * domain error with its retry window."
 *
 * ## What this is the evidence for
 *
 * `ForgeThrottlerGuard` raises `TooManyAttemptsError` rather than letting the
 * library answer. The library's own refusal is a `429` too, so a status
 * assertion alone cannot tell the two apart: it would pass with the guard
 * undone, carrying the library's untranslated prose and none of this
 * application's code. The assertions here are the ones the library's body
 * cannot satisfy — the code, the translated sentence, and the retry window the
 * caller is told to wait.
 *
 * It is driven through the real `AuthController`, the real bucket, the real
 * subject and the real limit, over a store that counts. Only the store is
 * replaced; see `meteredThrottling`.
 *
 * ## The cases
 *
 * - **The budget is per challenge, and a correct proof is refused once it is
 *   spent.** Otherwise a limit would bound only the guesses that are wrong.
 * - **A token that names no challenge is metered too.** The cheapest attack is
 *   to send garbage, so the budget must not be one that only honest callers
 *   draw down.
 * - **One challenge's exhaustion does not touch another's.** Without it the
 *   budget would be a single shared counter, and the first attacker would lock
 *   everybody out.
 *
 * ## What this file cannot see
 *
 * The store is in memory, so nothing here is evidence about the SQL that counts
 * in production. `throttling/__tests__/postgres-throttler.storage.spec.ts` owns
 * the halves of that decision which are in TypeScript, and says in its own
 * header that the counting semantics themselves are asserted nowhere in this
 * repository.
 */

/** The shipped limit for the bucket under test, read from the shipped definition. */
const ATTEMPTS_ALLOWED = buildBuckets(new ConfigService({}))['mfa-attempt'].limit;

/**
 * Counts in memory the way the library's contract says a store must: an attempt
 * past `limit` blocks the key for `blockDuration`, and a blocked key stops
 * counting.
 */
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
    // A blocked key stops counting, as the production store's does.
    this.hits.set(key, Math.min(hits, limit + 1));
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(blockDuration / 1000),
      isBlocked: blocked,
      timeToBlockExpire: blocked ? Math.ceil(blockDuration / 1000) : 0,
    };
  }
}

describe('D16 — a subject that exhausts its budget is refused with the domain error', () => {
  let world: MfaWorld;

  beforeEach(async () => {
    world = await makeMfaWorld({ throttling: new CountingStorage() });
  });

  afterEach(async () => {
    await world.close();
  });

  const challengeFor = async (user: SeededMfaUser): Promise<string> => {
    const response = await request(world.app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, secret: user.secret })
      .expect(200);
    return response.body.challengeToken as string;
  };

  /** A six-digit code that no step the verifier's window covers accepts. */
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

  const verify = (challengeToken: string, methodId: string, code: string): request.Test =>
    request(world.app.getHttpServer())
      .post('/auth/mfa/verify')
      .send({ challengeToken, methodId, code });

  it('refuses with 429, TOO_MANY_ATTEMPTS, a translated message and a retry window', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const challengeToken = await challengeFor(user);
    const wrong = wrongCodeFor(user.totpSecret);

    for (let attempt = 0; attempt < ATTEMPTS_ALLOWED; attempt += 1) {
      await verify(challengeToken, user.methodId, wrong).expect(401);
    }
    const refused = await verify(challengeToken, user.methodId, wrong).expect(429);

    expect(refused.body.code).toBe('TOO_MANY_ATTEMPTS');
    // The library's own body would read "ThrottlerException: Too Many Requests"
    // and carry no `code`; a key left untranslated would start with `errors.`.
    expect(refused.body.message).toBe('Too many attempts. Wait a moment and try again');
    expect(refused.headers['retry-after']).toEqual(expect.stringMatching(/^[1-9]\d*$/));
  });

  it('refuses the correct code once the challenge has spent its budget', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const challengeToken = await challengeFor(user);
    const wrong = wrongCodeFor(user.totpSecret);
    for (let attempt = 0; attempt < ATTEMPTS_ALLOWED; attempt += 1) {
      await verify(challengeToken, user.methodId, wrong).expect(401);
    }
    const sessionsBefore = world.sessionCount();

    const refused = await verify(
      challengeToken,
      user.methodId,
      currentCodeFor(user.totpSecret),
    ).expect(429);

    expect(refused.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(refused.body.accessToken).toBeUndefined();
    expect(world.sessionCount()).toBe(sessionsBefore);
  });

  it('meters a token that names no challenge', async () => {
    const user = await world.seedUserWithConfirmedTotp();

    for (let attempt = 0; attempt < ATTEMPTS_ALLOWED; attempt += 1) {
      await verify('names-no-challenge', user.methodId, '123456').expect(401);
    }
    const refused = await verify('names-no-challenge', user.methodId, '123456').expect(429);

    expect(refused.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('leaves another challenge its own budget', async () => {
    const user = await world.seedUserWithConfirmedTotp();
    const spent = await challengeFor(user);
    const wrong = wrongCodeFor(user.totpSecret);
    for (let attempt = 0; attempt <= ATTEMPTS_ALLOWED; attempt += 1) {
      await verify(spent, user.methodId, wrong);
    }

    const other = await challengeFor(user);
    await verify(other, user.methodId, currentCodeFor(user.totpSecret)).expect(200);
  });

  describe('a signed-in caller on a route the optional auth guard fronts', () => {
    // `POST /mfa/webauthn/*` is `@Public()` with a method-level
    // `OptionalJwtAuthGuard`, and `@ReadsSession()` has the global guard verify a
    // presented credential ahead of the throttler, so a signed-in caller's
    // subject is their account. The property pinned is that two signed-in callers
    // are two subjects: were every one of them to share a counter, anybody could
    // drain it for everybody.
    const MINT_ALLOWED = buildBuckets(new ConfigService({}))['mfa-mint'].limit;

    const signedIn = async (): Promise<string> => {
      const account = await world.seedUserWithoutMfa();
      const login = await request(world.app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, secret: account.secret })
        .expect(200);
      return `Bearer ${login.body.accessToken as string}`;
    };

    const options = (authorization: string): request.Test =>
      request(world.app.getHttpServer())
        .post('/mfa/webauthn/options')
        .set('Authorization', authorization)
        .send({});

    const verifyPasskey = (authorization: string): request.Test =>
      request(world.app.getHttpServer())
        .post('/mfa/webauthn/verify')
        .set('Authorization', authorization)
        .send({ response: {} });

    it('cannot exhaust another signed-in caller’s mint budget', async () => {
      const attacker = await signedIn();
      const bystander = await signedIn();

      for (let attempt = 0; attempt < MINT_ALLOWED; attempt += 1) {
        await options(attacker).expect(200);
      }
      await options(attacker).expect(429);

      await options(bystander).expect(200);
    });

    it('cannot exhaust another signed-in caller’s attempt budget', async () => {
      const attacker = await signedIn();
      const bystander = await signedIn();

      for (let attempt = 0; attempt < ATTEMPTS_ALLOWED; attempt += 1) {
        const refused = await verifyPasskey(attacker);
        expect(refused.status).not.toBe(429);
      }
      await verifyPasskey(attacker).expect(429);

      const bystanders = await verifyPasskey(bystander);
      expect(bystanders.status).not.toBe(429);
    });
  });
});
