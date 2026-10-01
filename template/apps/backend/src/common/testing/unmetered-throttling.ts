import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import { throttlerOptions } from '../../throttling/throttling.module';

/**
 * The throttler, configured so that a spec can attempt as often as it likes.
 *
 * ## Why every testing module needs this at all
 *
 * `ForgeThrottlerGuard` is in `GLOBAL_PROVIDERS`, and a spec that registers
 * that array registers the guard — which asks the library for its options and
 * its store. Neither exists in a testing module unless something puts them
 * there, so without this the module does not compile and the spec fails on
 * wiring rather than on anything it meant to assert.
 *
 * ## Why it counts rather than skipping
 *
 * These are **the shipped options**, so every route a spec exercises resolves
 * its real bucket, its real limit and its real subject. What is replaced is the
 * one thing that would make a suite's own repetition look like an attack: the
 * store never reports a subject blocked. A spec that signs in wrongly thirty
 * times to assert what a wrong credential answers is not testing the budget,
 * and it must not be refused by one.
 *
 * Where the budget itself is under test, the store is the thing to replace —
 * `__tests__/composition-root.spec.ts` passes one that reports a refusal, and
 * `throttling/__tests__/forge-throttler.guard.spec.ts` passes one that records
 * what it was asked to count, and `__tests__/discriminating/d16-throttle-refusal.spec.ts`
 * drives the real routes over one that counts and refuses.
 */
const NEVER_BLOCKS: ThrottlerStorage = {
  increment: async () => ({
    totalHits: 1,
    timeToExpire: 60,
    isBlocked: false,
    timeToBlockExpire: 0,
  }),
};

/** Spread into a testing module's `imports` alongside `GLOBAL_PROVIDERS`. */
export const UNMETERED_THROTTLING = ThrottlerModule.forRoot(
  throttlerOptions(new ConfigService({}), NEVER_BLOCKS),
);

/**
 * The shipped options over a store the spec supplies, for the spec whose
 * subject is the budget itself.
 *
 * {@link UNMETERED_THROTTLING} is the default for a reason a spec should not
 * have to rediscover: a suite that repeats a wrong credential thirty times is
 * not an attack. Where a refusal is the thing asserted, the spec passes a store
 * that counts, and the route, its bucket, its subject and its limit are still
 * the application's own.
 *
 * @param storage - the store the library will count attempts in
 * @returns a module to spread into a testing module's `imports`
 */
export function meteredThrottling(
  storage: ThrottlerStorage,
): ReturnType<typeof ThrottlerModule.forRoot> {
  return ThrottlerModule.forRoot(throttlerOptions(new ConfigService({}), storage));
}
