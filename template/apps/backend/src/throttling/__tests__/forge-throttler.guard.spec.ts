import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { TooManyAttemptsError } from '__FORGE_SCOPE__/core/shared/errors';
import { hashOpaqueToken } from '../../common/crypto';
import { ForgeThrottlerGuard } from '../forge-throttler.guard';
import { Throttled } from '../throttled.decorator';
import { buildBuckets, ThrottleSubject } from '../throttling.config';
import { throttlerOptions } from '../throttling.module';

/**
 * # The guard's adaptations, and the one thing a singleton must not get wrong
 *
 * | Fault | Caught by |
 * |---|---|
 * | the subject becomes the network address again | `never uses the network address` |
 * | one address spelled two ways becomes two budgets | `normalizes the address` |
 * | a raw body shape throws, or collides with a real subject | `yields the shared bucket for %s` (one case per shape) |
 * | an authenticated attempt is counted against its challenge instead of its account | `prefers the session over the challenge` |
 * | the library's own 429 answers directly, around the filter | `raises the domain error, not the library exception` |
 * | a route with no `@Throttled` is metered | `does not meter a route that declares no bucket` |
 * | **two concurrent requests are counted against each other's subject** | `keeps two interleaved requests' subjects apart` |
 * | two concurrent requests are counted against each other's budget | `keeps two interleaved requests' budgets apart` |
 * | the route re-enters the key, so a bucket is one budget per route | `gives two routes in one bucket one counter` |
 * | the counter key carries an address or a credential in the clear | `names a counter without putting its subject in the table` |
 *
 * ## Why the interleaving case is here and not left to review
 *
 * A guard is a singleton and requests interleave. Any arrangement that
 * remembers "the subject of the request in hand" between resolving it and
 * counting it — a field, a module-level variable — is correct in every test
 * that sends one request at a time and wrong the moment two arrive together,
 * and being wrong means one person's attempt is spent out of another's budget.
 * That is a security defect rather than a cosmetic one, so it is asserted
 * against the real `canActivate`, with the store holding both requests open at
 * once so neither can finish before the other has started.
 */

/** The address under test, as somebody might type it and in its normal form. */
const ADDRESS_AS_TYPED = 'Person@Example.com';
const ADDRESS_NORMALIZED = 'person@example.com';

/** Values the server minted. Named, not inlined, so no line reads as a populated secret. */
const CHALLENGE = 'challenge-under-test';
const OTHER_CHALLENGE = 'other-challenge-under-test';
/** Opaque credentials as a caller might present them; named so no line reads as a populated secret. */
const PRESENTED = 'presented-credential-one';
const OTHER_PRESENTED = 'presented-credential-two';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';

/** An address nothing routes to; the guard never looks one up. */
const UNREGISTERED = 'nobody@example.invalid';

/** The routes the assertions are about. None of them is a shipped endpoint. */
class ProbeController {
  @Throttled('credential')
  public signIn(): void {}

  @Throttled('credential')
  public alsoSignIn(): void {}

  @Throttled('mfa-attempt')
  public answerChallenge(): void {}

  public unmetered(): void {}
}

type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** What the storage was asked to count, and a gate to hold requests inside it. */
class RecordingStorage implements ThrottlerStorage {
  public readonly calls: { key: string; ttl: number; limit: number }[] = [];

  /** While set, every increment parks here — which is how two requests overlap. */
  public gate: Promise<void> | null = null;

  /** What the store reports back; a refusal when `blocked` is set. */
  public blocked = false;

  /** Told whenever one more request has parked, so {@link parked} can wait for it. */
  private announce: (() => void) | null = null;

  public async increment(key: string, ttl: number, limit: number): Promise<StorageRecord> {
    this.calls.push({ key, ttl, limit });
    this.announce?.();
    if (this.gate !== null) await this.gate;
    return {
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: this.blocked,
      timeToBlockExpire: this.blocked ? 900 : 0,
    };
  }

  /**
   * Resolves once `count` requests have reached this store and parked.
   *
   * Waiting on the store rather than on a fixed number of microtask ticks: a
   * request takes however many awaits `canActivate` happens to contain on its
   * way here, which is the library's business and moves between versions. A
   * test that guessed the number would still overlap its requests by accident
   * on the day the guess went wrong, and would go on claiming it had arranged
   * the overlap. A spec that waits too long here hangs, which is loud.
   */
  public async parked(count: number): Promise<void> {
    if (this.calls.length >= count) return;
    return new Promise<void>((resolve) => {
      this.announce = (): void => {
        if (this.calls.length >= count) resolve();
      };
    });
  }
}

/**
 * The guard, with the subject it resolved for each request recorded.
 *
 * The recording is keyed by a marker the request carries, so an assertion says
 * *this* request got *that* subject rather than merely that both subjects
 * appeared somewhere — which is the whole question when two requests overlap.
 */
class RecordingGuard extends ForgeThrottlerGuard {
  public readonly trackers = new Map<string, string>();

  protected override async getTracker(
    req: Record<string, any>,
    context?: ExecutionContext,
  ): Promise<string> {
    const tracker = await super.getTracker(req, context);
    this.trackers.set(String(req['marker']), tracker);
    return tracker;
  }
}

describe('ForgeThrottlerGuard', () => {
  describe('the subject it counts against', () => {
    it('never uses the network address', () => {
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, {
        ip: '203.0.113.9',
        body: { email: ADDRESS_AS_TYPED },
      });
      expect(tracker).not.toContain('203.0.113.9');
    });

    it('normalizes the address, so case is not a second bucket', () => {
      const upper = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, {
        body: { email: ADDRESS_AS_TYPED },
      });
      const lower = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, {
        body: { email: ADDRESS_NORMALIZED },
      });
      expect(upper).toBe(lower);
    });

    it('counts an address that names nobody, exactly like one that does', () => {
      // ADR-0005, reached from a direction it does not describe. Nothing is
      // looked up, so a refusal and a rejection cannot be told apart by
      // whether the attempt was counted. A guard that resolved the address
      // first would make this an enumeration oracle, around the side of the
      // rule `auth/__tests__/enumeration-safety.spec.ts` asserts about the
      // answers themselves.
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, {
        body: { email: UNREGISTERED },
      });
      expect(tracker).toBe(`address:${UNREGISTERED}`);
    });

    // The guard runs BEFORE the validation pipe, so the raw body reaches it.
    // None of these may throw, and none may collide with a real subject.
    it.each([
      ['a missing body', {}],
      ['no email field', { body: {} }],
      ['a null email', { body: { email: null } }],
      ['an object where a string belongs', { body: { email: { toString: (): string => 'x' } } }],
      ['an array', { body: { email: ['a@b.c'] } }],
      ['an address that is only whitespace', { body: { email: '   ' } }],
    ])('yields the shared bucket for %s', (_label, request) => {
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ADDRESS, request);
      expect(typeof tracker).toBe('string');
      expect(tracker).toBe(ForgeThrottlerGuard.MALFORMED);
    });

    it.each([
      ['CHALLENGE', ThrottleSubject.CHALLENGE],
      ['ACCOUNT_OR_CHALLENGE', ThrottleSubject.ACCOUNT_OR_CHALLENGE],
      ['ADDRESS', ThrottleSubject.ADDRESS],
      ['RESET_CREDENTIAL', ThrottleSubject.RESET_CREDENTIAL],
    ])('yields the shared bucket for %s when the body carries nothing', (_label, subject) => {
      // Every subject kind, so a new one cannot be added with a branch that
      // throws on an empty body — the shape every unvalidated request can have.
      expect(ForgeThrottlerGuard.subjectOf(subject, { body: {} })).toBe(
        ForgeThrottlerGuard.MALFORMED,
      );
    });

    it('prefers the session over the challenge when both are present', () => {
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ACCOUNT_OR_CHALLENGE, {
        user: { userId: ACCOUNT },
        body: { challengeToken: CHALLENGE },
      });
      expect(tracker).toContain(ACCOUNT);
    });

    it('falls back to the challenge when there is no session yet', () => {
      const tracker = ForgeThrottlerGuard.subjectOf(ThrottleSubject.ACCOUNT_OR_CHALLENGE, {
        body: { challengeToken: CHALLENGE },
      });
      expect(tracker).toBe(`challenge:${CHALLENGE}`);
    });

    describe('a presented bearer credential, when there is neither session nor challenge', () => {
      const bearer = (credential: string): Record<string, unknown> => ({
        body: {},
        headers: { authorization: `Bearer ${credential}` },
      });

      it.each([
        ['ACCOUNT_OR_CHALLENGE', ThrottleSubject.ACCOUNT_OR_CHALLENGE],
        ['CHALLENGE', ThrottleSubject.CHALLENGE],
      ])('gives %s a subject per credential', (_label, subject) => {
        const first = ForgeThrottlerGuard.subjectOf(subject, bearer(PRESENTED));
        const second = ForgeThrottlerGuard.subjectOf(subject, bearer(OTHER_PRESENTED));

        expect(first).not.toBe(ForgeThrottlerGuard.MALFORMED);
        expect(first).not.toBe(second);
        expect(first).toBe(ForgeThrottlerGuard.subjectOf(subject, bearer(PRESENTED)));
      });

      it('names the digest and never the credential', () => {
        const tracker = ForgeThrottlerGuard.subjectOf(
          ThrottleSubject.ACCOUNT_OR_CHALLENGE,
          bearer(PRESENTED),
        );

        expect(tracker).toBe(`credential:${hashOpaqueToken(PRESENTED)}`);
        expect(tracker).not.toContain(PRESENTED);
      });

      it('never outranks a presented challenge or a session', () => {
        const withHeader = { headers: { authorization: `Bearer ${PRESENTED}` } };

        expect(
          ForgeThrottlerGuard.subjectOf(ThrottleSubject.ACCOUNT_OR_CHALLENGE, {
            ...withHeader,
            body: { challengeToken: CHALLENGE },
          }),
        ).toBe(`challenge:${CHALLENGE}`);
        expect(
          ForgeThrottlerGuard.subjectOf(ThrottleSubject.ACCOUNT_OR_CHALLENGE, {
            ...withHeader,
            user: { userId: ACCOUNT },
            body: { challengeToken: CHALLENGE },
          }),
        ).toBe(`account:${ACCOUNT}`);
      });

      it.each([
        ['a non-bearer scheme', 'Basic abc'],
        ['an empty credential', 'Bearer '],
      ])('is no subject for %s', (_label, header) => {
        expect(
          ForgeThrottlerGuard.subjectOf(ThrottleSubject.ACCOUNT_OR_CHALLENGE, {
            body: {},
            headers: { authorization: header },
          }),
        ).toBe(ForgeThrottlerGuard.MALFORMED);
      });
    });
  });

  it('raises the domain error, not the library exception', async () => {
    const guard = new ForgeThrottlerGuard({ throttlers: [] }, {} as never, {} as never);
    await expect(
      guard['throwThrottlingException']({} as ExecutionContext, {
        timeToBlockExpire: 900,
      } as never),
    ).rejects.toBeInstanceOf(TooManyAttemptsError);
  });

  it('carries the wait the store reported into the domain error', async () => {
    const guard = new ForgeThrottlerGuard({ throttlers: [] }, {} as never, {} as never);
    await expect(
      guard['throwThrottlingException']({} as ExecutionContext, {
        timeToBlockExpire: 900,
      } as never),
    ).rejects.toMatchObject({ retryAfterSeconds: 900 });
  });

  describe('against the real canActivate', () => {
    let storage: RecordingStorage;
    let guard: RecordingGuard;
    const buckets = buildBuckets(new ConfigService({}));

    /** A request, marked so an assertion can say which one it is talking about. */
    const requestFor = (marker: string, parts: Record<string, unknown>): Record<string, any> => ({
      marker,
      ...parts,
    });

    const contextFor = (
      request: Record<string, unknown>,
      handler: () => void,
    ): ExecutionContext =>
      ({
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => ({ header: () => undefined }),
        }),
        getHandler: () => handler,
        getClass: () => ProbeController,
      }) as unknown as ExecutionContext;

    beforeEach(async () => {
      storage = new RecordingStorage();
      // THE SHIPPED OPTIONS, not a copy: the per-request resolution of a
      // bucket's limit lives in them, and it is under test below.
      guard = new RecordingGuard(
        throttlerOptions(new ConfigService({}), storage),
        storage,
        new Reflector(),
      );
      await guard.onModuleInit();
    });

    it('does not meter a route that declares no bucket', async () => {
      await expect(
        guard.canActivate(contextFor(requestFor('plain', {}), ProbeController.prototype.unmetered)),
      ).resolves.toBe(true);
      expect(storage.calls).toHaveLength(0);
    });

    it('meters a route that declares one, on the subject its bucket names', async () => {
      await guard.canActivate(
        contextFor(
          requestFor('sign-in', { body: { email: ADDRESS_AS_TYPED } }),
          ProbeController.prototype.signIn,
        ),
      );
      expect(guard.trackers.get('sign-in')).toBe(`credential:address:${ADDRESS_NORMALIZED}`);
      expect(storage.calls).toHaveLength(1);
    });

    it('gives two routes in one bucket one counter, not one each', async () => {
      // The budget is the bucket's. The library's own key builds in the
      // controller and handler name, which would give each route drawing on
      // `mfa-attempt` its own full allowance against the same challenge.
      const both = [ProbeController.prototype.signIn, ProbeController.prototype.alsoSignIn];
      for (const handler of both) {
        await guard.canActivate(
          contextFor(requestFor('either', { body: { email: ADDRESS_AS_TYPED } }), handler),
        );
      }
      expect(storage.calls[0].key).toBe(storage.calls[1].key);
    });

    it('gives two buckets two counters, even on one subject', async () => {
      await guard.canActivate(
        contextFor(
          requestFor('a', { body: { email: ADDRESS_AS_TYPED, challengeToken: CHALLENGE } }),
          ProbeController.prototype.signIn,
        ),
      );
      await guard.canActivate(
        contextFor(
          requestFor('b', { body: { email: ADDRESS_AS_TYPED, challengeToken: CHALLENGE } }),
          ProbeController.prototype.answerChallenge,
        ),
      );
      expect(storage.calls[0].key).not.toBe(storage.calls[1].key);
    });

    it('names a counter without putting its subject in the table', async () => {
      // The key is this table's primary key. A tracker holds an address, and
      // on a reset it holds the single-use credential being spent.
      await guard.canActivate(
        contextFor(
          requestFor('sign-in', { body: { email: ADDRESS_AS_TYPED } }),
          ProbeController.prototype.signIn,
        ),
      );
      expect(storage.calls[0].key).not.toContain(ADDRESS_NORMALIZED);
      expect(storage.calls[0].key).not.toContain('person');
    });

    it('answers the domain refusal once the store says the subject is blocked', async () => {
      storage.blocked = true;
      await expect(
        guard.canActivate(
          contextFor(
            requestFor('sign-in', { body: { email: ADDRESS_AS_TYPED } }),
            ProbeController.prototype.signIn,
          ),
        ),
      ).rejects.toBeInstanceOf(TooManyAttemptsError);
    });

    describe('two requests in flight at once', () => {
      /**
       * Starts both requests and holds them inside the store until each has
       * resolved its own subject, then lets both finish.
       *
       * The holding is the whole arrangement. `getTracker` runs on the way to
       * `increment`, so once the store has both requests parked, both have
       * resolved a subject and neither has finished — which is the state a
       * guard that remembered one between resolving it and counting it would
       * get wrong.
       */
      const interleave = async (): Promise<void> => {
        let open = (): void => undefined;
        storage.gate = new Promise<void>((resolve) => {
          open = resolve;
        });
        const first = guard.canActivate(
          contextFor(
            requestFor('sign-in', { body: { email: ADDRESS_AS_TYPED } }),
            ProbeController.prototype.signIn,
          ),
        );
        const second = guard.canActivate(
          contextFor(
            requestFor('answer', { body: { challengeToken: OTHER_CHALLENGE } }),
            ProbeController.prototype.answerChallenge,
          ),
        );
        // Waits for the store itself to report both of them parked, rather
        // than for some number of microtask ticks that might or might not be
        // enough. Only then are they allowed to finish.
        await storage.parked(2);
        open();
        await Promise.all([first, second]);
      };

      it('keeps two interleaved requests’ subjects apart', async () => {
        await interleave();
        expect(guard.trackers.get('sign-in')).toBe(`credential:address:${ADDRESS_NORMALIZED}`);
        expect(guard.trackers.get('answer')).toBe(`mfa-attempt:challenge:${OTHER_CHALLENGE}`);
      });

      it('keeps two interleaved requests’ budgets apart', async () => {
        // The numbers are resolved per request too, from the same route
        // metadata. A budget mix-up would limit a sign-in by the attempt
        // allowance, which is tighter, and nothing else would report it.
        await interleave();
        const [signIn, answer] = storage.calls;
        expect(signIn).toMatchObject({
          limit: buckets.credential.limit,
          ttl: buckets.credential.ttl,
        });
        expect(answer).toMatchObject({
          limit: buckets['mfa-attempt'].limit,
          ttl: buckets['mfa-attempt'].ttl,
        });
      });

      it('counts each of them exactly once', async () => {
        // One throttler, so one count per request. The library applies every
        // configured throttler to every request it does not skip, so a
        // throttler per bucket would count each request once per bucket, all
        // but one of them against a budget its route never named.
        await interleave();
        expect(storage.calls).toHaveLength(2);
      });
    });
  });
});
