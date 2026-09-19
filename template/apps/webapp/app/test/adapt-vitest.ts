import { expect } from 'vitest';
import type { ConformanceExpect } from '__FORGE_SCOPE__/core/shared/testing';
import { explain } from '__FORGE_SCOPE__/core/shared/testing';

/**
 * Vitest, adapted to the three-method surface core's conformance suites are
 * driven through.
 *
 * ## Why an adapter exists at all, and why it is not a cast
 *
 * {@link ConformanceExpect} is `equal`/`ok`/`rejects` and nothing else — not a
 * matcher chain — so vitest's `expect` cannot be passed through with a cast. That
 * shape is deliberate: it is the smallest surface every runner can satisfy, and
 * it is what lets one suite in `libs/core` be run by jest in the backend and by
 * vitest here without either runner leaking into core.
 *
 * ## The third argument, which is the whole reason this is written carefully
 *
 * Every method takes an optional `message`, and **an adapter that drops it throws
 * away the only thing that says why a contract rejected an implementation.** The
 * suites are full of lines like
 *
 * ```ts
 * expect.ok(
 *   actorEmailAsGiven !== normalizeEmail(actorEmailAsGiven),
 *   'the world must seed the actor from an address the domain has to normalize',
 * );
 * ```
 *
 * where the sentence is a precondition about the *world the host built*, not
 * about the service — so the person who has to act on the failure is the person
 * who wrote the driver, and the sentence is the instruction. Dropped, that
 * failure reads `expected false to be truthy` at a line number inside
 * `libs/core`, and whoever hits it has to reverse-engineer the obligation from
 * the suite's source.
 *
 * ## Where this deliberately differs from `adapt-jest.ts`, and why
 *
 * The backend's adapter raises the message by hand, through core's
 * `explain`, because jest has no message argument at all —
 * `expect(false, 'msg')` fails outright with `Expect takes at most one argument`.
 * **Vitest does have one**, and it prefixes: `expect(false, 'msg').toBeTruthy()`
 * reports `msg: expected false to be truthy`. That was measured in this project
 * before this file was written, not assumed from the two runners looking alike.
 *
 * So `equal` passes the sentence to vitest and lets it do the prefixing, which
 * keeps the failure on one line and keeps vitest's own structured diff intact —
 * something `explain` cannot do, as it says on itself, because rewrapping loses a
 * runner-specific payload.
 *
 * `ok` does **not**, and that is the one place the two adapters agree by
 * disagreeing. Vitest's own text for a falsy value is `expected false to be
 * truthy`, which restates the argument and tells a reader nothing they cannot
 * see, so the sentence is thrown alone rather than decorated with it. That is
 * exactly what `adapt-jest.ts` does for the same reason.
 *
 * `rejects` does not either, and this one was a surprise the adapter's own spec
 * caught. **Vitest drops the second argument when the promise resolves instead
 * of rejecting** — measured:
 *
 * ```
 * expect(async () => Promise.resolve(), 'it must refuse').rejects.toBeInstanceOf(A)
 *   → promise resolved "undefined" instead of rejecting
 * ```
 *
 * with no sign of the sentence. That is the single case where the sentence
 * matters most: the implementation did not refuse at all, and "it must refuse" is
 * the whole of what a reader needs. The message is therefore raised here, through
 * `explain`, on every failing path of this method rather than only on that one —
 * one rule is easier to keep true than a rule with an exception in it.
 *
 * Read as a promise rather than as an implementation, the two adapters offer the
 * identical three properties, which is what lets one suite be driven by either.
 *
 * @returns the assertion surface to hand a conformance suite
 */
export function adaptVitestToConformanceExpect(): ConformanceExpect {
  return {
    equal<T>(actual: T, expected: T, message?: string): void {
      // `expect(actual, undefined)` is not the same call as `expect(actual)` in
      // every runner, so the no-message path does not pass one.
      if (message === undefined) expect(actual).toBe(expected);
      else expect(actual, message).toBe(expected);
    },

    ok(value: unknown, message?: string): void {
      if (value) return;
      // The message IS the failure, so it is thrown as one rather than decorated
      // with a matcher's account of a value the reader can see is falsy.
      if (message !== undefined) throw new Error(message);
      expect(value).toBeTruthy();
    },

    async rejects(
      operation: () => Promise<unknown>,
      errorType: new (...args: never[]) => Error,
      message?: string,
    ): Promise<void> {
      // The operation is wrapped rather than invoked into `expect(...)`, so a
      // synchronous throw is caught by the matcher too. `expect(operation())`
      // would let such a throw escape before vitest ever saw it, and the suite
      // would report the raw error rather than "it did not reject with X" —
      // which is a different claim, and a misleading one when the raw error IS
      // the expected type. Measured here, not carried over from jest: the probe
      // that established it produced an empty message, which is the raw error.
      const attempt = async (): Promise<unknown> => operation();
      try {
        await expect(attempt).rejects.toBeInstanceOf(errorType);
      } catch (error) {
        // Not `expect(attempt, message)`: vitest drops that argument on the
        // resolved-instead-of-rejected path. See this file's header.
        throw explain(error, message);
      }
    },
  };
}
