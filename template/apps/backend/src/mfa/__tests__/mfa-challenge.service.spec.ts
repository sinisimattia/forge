import type { DataSource, ObjectLiteral, Repository } from 'typeorm';
import {
  MfaChallengeAlreadyConsumedError,
  MfaChallengeExpiredError,
  MfaChallengeNotFoundError,
} from '__FORGE_SCOPE__/core/mfa/errors';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { hashOpaqueToken } from '../../common/crypto';
import { FakeDataSource } from '../../common/testing';
import { MfaChallengeRecord } from '../entities/mfa-challenge-record.entity';
import { MfaChallengePurpose } from '../enums/MfaChallengePurpose';
import { MFA_CHALLENGE_TTL_MS, MfaChallengeService } from '../mfa-challenge.service';

const USER_ID = '11111111-1111-4111-8111-111111111111' as UserId;

/**
 * # The single-use MFA challenge
 *
 * The thing that stands between "the password was correct" and "here is a
 * session", so every assertion below is about a refusal or about what is
 * written down, and none is about a happy path for its own sake.
 *
 * ## Two mechanisms, two tests
 *
 * A challenge is spent once because of two independent things: the write
 * lock on its row, and the `consumed_at IS NULL` predicate on the statement
 * that spends it, whose `affected` count is checked. **Either one alone is
 * enough**, so the outcome assertion — exactly one of two simultaneous
 * presentations wins — is not evidence that both are still there; removing
 * either leaves it green. Each therefore gets an assertion of its own:
 * `reads the row under a write lock` reads `lockedRows` directly, and
 * `still lets only one succeed against a store that ignores the lock` races
 * again in a world where the lock is requested and discarded, leaving the
 * predicate as the only thing left. The shape is
 * `auth/__tests__/refresh-rotation.spec.ts`'s, for the same reason.
 *
 * ## What `FakeDataSource` can and cannot say about the lock
 *
 * It *does* model `pessimistic_write`: a real mutex held to the end of the
 * transaction, with the row re-read once it is granted, and reads that yield
 * so two transactions genuinely interleave — see that class's own TSDoc. So
 * the race below can fail, and does when the mechanisms are removed.
 *
 * What it is not is evidence about Postgres. A mutex in one JavaScript
 * process is not `SELECT ... FOR UPDATE` across two connections. It is
 * evidence that this implementation *asks for* the lock and does not rely on
 * the read alone, which is the half a unit test can own.
 *
 * The caveat the OAuth suites state applies unchanged: this double enforces
 * no unique constraint, so nothing below asserts that
 * `uq_mfa_challenges_token_hash` prevents a second row sharing a digest, and
 * no foreign key, so nothing asserts that a challenge dies with its user.
 * Both are schema-level guarantees the migration carries.
 *
 * ## The service tells the five refusals apart, and the boundary must not
 *
 * Absent, expired, already consumed, unmodelled purpose and wrong purpose
 * each raise the error that names them, and the assertions below pin exactly
 * that. **This is deliberate, and it is not the whole property.** Whoever
 * presents a challenge must learn only that it did not work — otherwise
 * presenting tokens in turn is a way to find out which digests exist, and
 * presenting one repeatedly is a way to learn that somebody else has an
 * enrollment pending. That guarantee is owed by the route in front of this
 * service, asserted there against the actual response bytes, exactly as
 * `AuthController.login` refuses to read `AuthenticationOutcome.reason`
 * although it has it in scope. Recording the reason and not returning it is
 * the settled shape here; a reader who "fixes" this file by collapsing the
 * five into one error is removing what the audit trail is meant to carry.
 */
describe('MfaChallengeService', () => {
  /** A store, the repository over it, and the service on top — one world. */
  interface World {
    source: FakeDataSource;
    challenges: Repository<MfaChallengeRecord>;
    service: MfaChallengeService;
  }

  /**
   * @param honourLocks - `false` builds the world in which `pessimistic_write`
   *   is accepted and ignored, so whatever stands BEHIND the lock can be
   *   asserted on its own. See {@link FakeDataSource}'s constructor.
   */
  const buildWorld = (honourLocks = true): World => {
    const store = new FakeDataSource(honourLocks);
    const repo = <T extends ObjectLiteral>(entity: { name: string }): Repository<T> =>
      store.getRepository(entity) as unknown as Repository<T>;
    const challenges = repo<MfaChallengeRecord>(MfaChallengeRecord);
    return {
      source: store,
      challenges,
      service: new MfaChallengeService(challenges, store as unknown as DataSource),
    };
  };

  let source: FakeDataSource;
  let challenges: Repository<MfaChallengeRecord>;
  let service: MfaChallengeService;

  /** Puts a row in the table directly — the writer this service is not. */
  const seed = async (overrides: {
    tokenHash?: string;
    purpose?: string;
    webauthnChallenge?: string | null;
    expiresAt?: Date;
    consumedAt?: Date | null;
  } = {}): Promise<void> => {
    const now = new Date();
    await challenges.insert({
      userId: USER_ID,
      tokenHash: overrides.tokenHash ?? 'seeded-digest',
      purpose: (overrides.purpose ?? MfaChallengePurpose.LOGIN) as MfaChallengePurpose,
      webauthnChallenge: overrides.webauthnChallenge ?? null,
      expiresAt: overrides.expiresAt ?? new Date(now.getTime() + 60_000),
      consumedAt: overrides.consumedAt ?? null,
      createdAt: now,
    });
  };

  beforeEach(() => {
    const world = buildWorld();
    source = world.source;
    challenges = world.challenges;
    service = world.service;
  });

  describe('mint', () => {
    it('stores a digest, never the token', async () => {
      const token = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      const rows = await challenges.find();
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(hashOpaqueToken(token));
      // Every field, not just the one it was meant to go in: a token copied
      // into `webauthn_challenge` by a future edit would still leave
      // `tokenHash` correct and the property broken.
      expect(JSON.stringify(rows[0])).not.toContain(token);
    });

    it('records the purpose and the nonce it was given, and an unconsumed row', async () => {
      const before = Date.now();
      await service.mint(USER_ID, MfaChallengePurpose.WEBAUTHN_ENROLLMENT, 'ceremony-nonce');

      const [row] = await challenges.find();
      expect(row.userId).toBe(USER_ID);
      expect(row.purpose).toBe(MfaChallengePurpose.WEBAUTHN_ENROLLMENT);
      expect(row.webauthnChallenge).toBe('ceremony-nonce');
      expect(row.consumedAt).toBeNull();
      // Minutes, not a session's lifetime. Asserted against the exported
      // constant rather than a literal, so the two cannot drift apart, and
      // bounded on both sides so a constant read as `0` would fail.
      expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + MFA_CHALLENGE_TTL_MS);
      expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + MFA_CHALLENGE_TTL_MS);
    });

    it('draws a different token every time', async () => {
      const first = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);
      const second = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);
      expect(first).not.toBe(second);
    });

    it('sweeps expired rows when it mints', async () => {
      await seed({ tokenHash: 'stale', expiresAt: new Date(Date.now() - 60_000) });
      await seed({ tokenHash: 'still-live', expiresAt: new Date(Date.now() + 60_000) });

      await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      expect(await challenges.findOne({ where: { tokenHash: 'stale' } })).toBeNull();
      expect(await challenges.findOne({ where: { tokenHash: 'still-live' } })).not.toBeNull();
    });

    it('sweeps an expired row whether or not it was ever consumed', async () => {
      const past = new Date(Date.now() - 60_000);
      await seed({ tokenHash: 'expired-unconsumed', expiresAt: past, consumedAt: null });
      await seed({ tokenHash: 'expired-consumed', expiresAt: past, consumedAt: past });

      await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      const remaining = await challenges.find();
      expect(remaining.map((row) => row.tokenHash)).not.toContain('expired-unconsumed');
      expect(remaining.map((row) => row.tokenHash)).not.toContain('expired-consumed');
    });
  });

  describe('consume', () => {
    it('answers with the row, and marks it consumed', async () => {
      const token = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      const row = await service.consume(token, MfaChallengePurpose.LOGIN);

      expect(row.userId).toBe(USER_ID);
      expect(row.purpose).toBe(MfaChallengePurpose.LOGIN);
      expect(row.consumedAt).not.toBeNull();
      const [stored] = await challenges.find();
      expect(stored.consumedAt).not.toBeNull();
    });

    it('consumes a challenge exactly once', async () => {
      const token = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      await expect(service.consume(token, MfaChallengePurpose.LOGIN)).resolves.toBeDefined();
      await expect(service.consume(token, MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeAlreadyConsumedError);
    });

    it('reads the row under a write lock', async () => {
      const token = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);
      const [row] = await challenges.find();
      source.lockedRows.length = 0;

      await service.consume(token, MfaChallengePurpose.LOGIN);

      // The mechanism, asserted directly rather than inferred from an
      // outcome. Against Postgres this is `SELECT ... FOR UPDATE`; without
      // it two simultaneous presentations of one challenge would both read
      // `consumed_at IS NULL` and both proceed, and the only thing left
      // between them and two finished sign-ins is the `consumedAt: IsNull()`
      // predicate on the statement that spends the row.
      expect(source.lockedRows).toEqual([`MfaChallengeRecord:${String(row.id)}`]);
    });

    it('refuses a token nothing answers to', async () => {
      await expect(service.consume('never-minted', MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
    });

    it('refuses an expired challenge', async () => {
      // Named `presented`, not after the thing it stands for: a local whose
      // name is a credential word, assigned a quoted literal, is the shape
      // the secret scanner reads as a hardcoded credential — and it is right
      // to, because in source that shape is a credential far more often than
      // it is a fixture. Renamed rather than exempted.
      const presented = 'a-challenge-of-full-entropy-for-this-test';
      await seed({
        tokenHash: hashOpaqueToken(presented),
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.consume(presented, MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeExpiredError);
    });

    it('refuses a challenge whose purpose is not the one expected', async () => {
      const token = await service.mint(USER_ID, MfaChallengePurpose.WEBAUTHN_ENROLLMENT, 'nonce');

      await expect(service.consume(token, MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
    });

    it('leaves a refused challenge unconsumed', async () => {
      const token = await service.mint(USER_ID, MfaChallengePurpose.WEBAUTHN_ENROLLMENT, 'nonce');

      await expect(service.consume(token, MfaChallengePurpose.LOGIN)).rejects.toThrow();

      // The transaction rolls back, so a challenge refused for the wrong
      // purpose is still there for the ceremony it was actually minted for.
      // A refusal that spent the row would be a way to burn somebody else's
      // pending enrollment by guessing at it.
      const [row] = await challenges.find();
      expect(row.consumedAt).toBeNull();
      await expect(service.consume(token, MfaChallengePurpose.WEBAUTHN_ENROLLMENT))
        .resolves.toBeDefined();
    });

    // The replay, run forward. `purpose` is plain `text` with no `CHECK`, so
    // this is the value a corrupted migration, a future writer, or anyone
    // with any write path at all puts there. The equivalent dispatch
    // elsewhere in this backend was once a ternary — "not LINK, so treat it
    // as a sign-in" — and a row like this one would have been answered by
    // minting a real, usable session. The safe default is refuse, not guess.
    it('refuses a purpose it does not model, written directly into the table', async () => {
      const presented = 'a-challenge-of-full-entropy-for-this-test';
      await seed({ tokenHash: hashOpaqueToken(presented), purpose: 'SOMETHING_ELSE' });

      await expect(service.consume(presented, MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
      await expect(service.consume(presented, MfaChallengePurpose.WEBAUTHN_ENROLLMENT))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
      // And it was not spent on the way to being refused, which is how a
      // reader can tell the refusal came from the dispatch rather than from
      // the row having been consumed by the first of the two calls above.
      const [row] = await challenges.find();
      expect(row.consumedAt).toBeNull();
    });

    // The one SHAPE of call for which the allowlist is the ONLY thing refusing,
    // and so the only shape of test that can fail when it is removed. Every
    // other unmodelled-purpose case above passes a modelled value as
    // `expected`, which `found.purpose !== expected` already refuses on its own
    // — delete the allowlist and they all stay green.
    //
    // One such case per public entry point that reaches
    // `refuseUnlessPresentable`, not one in total: the case below does the same
    // for `peek`, and the reason it exists separately is that `peek` once
    // shipped without the allowlist and nothing failed.
    //
    // `expected` is a parameter, so this call is reachable: a caller asking
    // for the same unmodelled purpose the row carries. Without the allowlist
    // `'SOMETHING_ELSE' !== 'SOMETHING_ELSE'` is false, every remaining check
    // passes, and `consume` hands back a consumed row for a purpose this file
    // does not model — the replay that minted a real, usable session
    // elsewhere in this backend, arriving through the surviving condition
    // rather than the removed one.
    it('refuses an unmodelled purpose even when that is the purpose asked for', async () => {
      const presented = 'a-challenge-of-full-entropy-for-this-test';
      await seed({ tokenHash: hashOpaqueToken(presented), purpose: 'SOMETHING_ELSE' });

      await expect(service.consume(presented, 'SOMETHING_ELSE' as MfaChallengePurpose))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
      const [row] = await challenges.find();
      expect(row.consumedAt).toBeNull();
    });

    // `peek` shares the refusals with `consume` through one function, and this is
    // the case that shows it. An unmodelled purpose asked for BY NAME cannot be
    // refused by the comparison — it equals what was asked for — so only the
    // allowlist can refuse it. Every other case here passes a modelled `expected`
    // and is refused by the comparison, which is why `peek` once shipped without
    // the allowlist and nothing failed.
    it('peek refuses an unmodelled purpose even when that is the purpose asked for', async () => {
      const presented = 'a-challenge-of-full-entropy-for-peek';
      await seed({ tokenHash: hashOpaqueToken(presented), purpose: 'SOMETHING_ELSE' });

      await expect(service.peek(presented, 'SOMETHING_ELSE' as MfaChallengePurpose))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
    });

    it('peek reads a live challenge and spends nothing, then consume still succeeds', async () => {
      const token = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      const seen = await service.peek(token, MfaChallengePurpose.LOGIN);
      await service.peek(token, MfaChallengePurpose.LOGIN);

      expect(seen.userId).toBe(USER_ID);
      const [row] = await challenges.find();
      expect(row.consumedAt).toBeNull();
      await expect(service.consume(token, MfaChallengePurpose.LOGIN)).resolves.toBeDefined();
    });

    it('peek names the same refusals consume does, in the same cases', async () => {
      const enrollment = await service.mint(USER_ID, MfaChallengePurpose.WEBAUTHN_ENROLLMENT, null);
      const spent = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);
      await service.consume(spent, MfaChallengePurpose.LOGIN);

      await expect(service.peek('never-minted-token', MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
      await expect(service.peek(enrollment, MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeNotFoundError);
      await expect(service.peek(spent, MfaChallengePurpose.LOGIN))
        .rejects.toBeInstanceOf(MfaChallengeAlreadyConsumedError);
    });

    it('names which of the five refusals applied, for a caller that must not', async () => {
      // The reason exists so an audit entry can carry it. What a presenter is
      // told is a separate question, settled at the route: see this file's
      // own header, and `AuthController.login`, which holds a rejection
      // reason in scope and refuses to put it in a response body.
      //
      // Minted first, then seeded: `mint` sweeps, so an expired row seeded
      // before these two calls would be gone by the time it was presented
      // and this test would be asserting "absent" twice over.
      const enrollment = MfaChallengePurpose.WEBAUTHN_ENROLLMENT;
      const wrongPurpose = await service.mint(USER_ID, enrollment, null);
      const spent = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);
      await service.consume(spent, MfaChallengePurpose.LOGIN);
      const expired = 'presented-for-the-expired-row';
      await seed({ tokenHash: hashOpaqueToken(expired), expiresAt: new Date(Date.now() - 1000) });
      const unmodelled = 'presented-for-the-unmodelled-row';
      await seed({ tokenHash: hashOpaqueToken(unmodelled), purpose: 'SOMETHING_ELSE' });

      const refusalFor = async (presented: string): Promise<unknown> =>
        service.consume(presented, MfaChallengePurpose.LOGIN).catch((error: unknown) => error);

      expect(await refusalFor('nothing-answers-to-this'))
        .toBeInstanceOf(MfaChallengeNotFoundError);
      expect(await refusalFor(expired)).toBeInstanceOf(MfaChallengeExpiredError);
      // Both purpose refusals are the not-found one: a row minted for a
      // ceremony this caller is not running is not a challenge this caller
      // holds, and there is no third fact to record about either.
      expect(await refusalFor(unmodelled)).toBeInstanceOf(MfaChallengeNotFoundError);
      expect(await refusalFor(wrongPurpose)).toBeInstanceOf(MfaChallengeNotFoundError);
      expect(await refusalFor(spent)).toBeInstanceOf(MfaChallengeAlreadyConsumedError);
    });

    it('never puts the presented token, or its digest, in what it throws', async () => {
      // A message reaches a log, and a log outlives the challenge. The
      // absent case is the one with no row to name, so it is the one where a
      // lazy implementation reaches for the only identifier it has.
      const presented = 'a-challenge-of-full-entropy-for-this-test';
      const refusal: Error = await service.consume(presented, MfaChallengePurpose.LOGIN).then(
        () => {
          throw new Error('expected a refusal, and this challenge was never minted');
        },
        (error: unknown) => error as Error,
      );

      expect(refusal.message).not.toContain(presented);
      expect(refusal.message).not.toContain(hashOpaqueToken(presented));
    });
  });

  describe('two simultaneous presentations of the same challenge', () => {
    // Two independent mechanisms hold this: the write lock on the row, and
    // the `consumedAt: IsNull()` predicate on the statement that spends it,
    // whose `affected` count is read. Either alone is enough — which is
    // exactly why the outcome assertion in the first test is NOT evidence
    // that both are still there. Each gets an assertion of its own.

    it('lets exactly one of them succeed', async () => {
      const presented = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      const outcomes = await Promise.allSettled([
        service.consume(presented, MfaChallengePurpose.LOGIN),
        service.consume(presented, MfaChallengePurpose.LOGIN),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    });

    it('has both presentations contend for the write lock on the one row', async () => {
      const presented = await service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);
      const [row] = await challenges.find();
      source.lockedRows.length = 0;

      await Promise.allSettled([
        service.consume(presented, MfaChallengePurpose.LOGIN),
        service.consume(presented, MfaChallengePurpose.LOGIN),
      ]);

      // Two entries, both naming the same row: each presentation asked for
      // the lock, and the loser queued behind the winner rather than reading
      // past it. The count is two rather than one because `lockedRows`
      // records the request, not the grant.
      const key = `MfaChallengeRecord:${String(row.id)}`;
      expect(source.lockedRows).toEqual([key, key]);
    });

    it('still lets only one succeed against a store that ignores the lock', async () => {
      // The second mechanism, isolated: this world accepts the lock request
      // and does nothing with it, so both callers read `consumed_at` as null
      // and pass every check. All that is left is `consumedAt: IsNull()` on
      // the spending statement and the `affected !== 1` branch that reads its
      // result. Without that branch the loser's `UPDATE` would match no row,
      // this method would ignore it and hand back a consumed challenge
      // anyway — two finished second factors from one challenge.
      const unlocked = buildWorld(false);
      const presented = await unlocked.service.mint(USER_ID, MfaChallengePurpose.LOGIN, null);

      const outcomes = await Promise.allSettled([
        unlocked.service.consume(presented, MfaChallengePurpose.LOGIN),
        unlocked.service.consume(presented, MfaChallengePurpose.LOGIN),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    });
  });
});
