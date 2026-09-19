import type { ConformanceExpect } from '__FORGE_SCOPE__/core/shared/testing';
import { explain } from '__FORGE_SCOPE__/core/shared/testing';

/**
 * Jest, adapted to the three-method surface core's conformance suites are
 * driven through.
 *
 * ## Why an adapter exists at all
 *
 * {@link ConformanceExpect} is `equal`/`ok`/`rejects` and nothing else — not a
 * matcher chain — so jest's `expect` cannot be passed through with a cast. That
 * shape is deliberate: it is the smallest surface every runner can satisfy, and
 * it is what lets one suite in `libs/core` be run by jest here and by vitest in
 * the webapp (Task 16) without either runner leaking into core.
 *
 * ## The third argument, which is the whole reason this is written carefully
 *
 * Every method takes an optional `message`, and **an adapter that drops it
 * throws away the only thing that says why a contract rejected an
 * implementation.** The suites are full of lines like
 *
 * ```ts
 * expect.ok(
 *   actor.email !== actorEmailAsGiven,
 *   'the world must seed the actor from an address the domain has to normalize',
 * );
 * ```
 *
 * where the sentence is a precondition about the *world the host built*, not
 * about the service — so the person who has to act on the failure is the person
 * who wrote the driver, and the sentence is the instruction. Dropped, that
 * failure reads `expect(received).toBeTruthy() / Received: false` at a line
 * number inside `libs/core`, and whoever hits it has to reverse-engineer the
 * obligation from the suite's source.
 *
 * Jest has no built-in message argument — `expect(false, 'msg')` fails outright
 * with `Expect takes at most one argument` — so the message is raised here:
 *
 * - **`ok`** raises the message *itself*. Jest's own text for a falsy value is
 *   `Received: false`, which says nothing the reader did not already know, so
 *   prefixing it would be noise. Without a message it falls back to the matcher,
 *   because something has to be thrown.
 * - **`equal` and `rejects`** prefix the message to jest's text, which there
 *   carries the structured diff — the two values, or the error that arrived
 *   instead of the expected one. Both halves are wanted: the sentence says what
 *   the property is, the diff says what happened.
 *
 * Prefixing is {@link explain}, which lives in core because every host needs the
 * same three lines and none of them are runner-specific. Its one cost is stated
 * there: jest's `matcherResult` payload does not survive the rewrap, so an IDE
 * that renders a structured diff falls back to rendering the text. The text is
 * the part a reader needs and it is preserved in full.
 *
 * @returns the assertion surface to hand a conformance suite
 */
export function adaptJestToConformanceExpect(): ConformanceExpect {
  return {
    equal<T>(actual: T, expected: T, message?: string): void {
      try {
        expect(actual).toBe(expected);
      } catch (error) {
        throw explain(error, message);
      }
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
      try {
        // The operation is wrapped rather than invoked into `expect(...)`, so a
        // synchronous throw is caught by the matcher too. `expect(operation())`
        // would let such a throw escape before jest ever saw it, and the suite
        // would report the raw error rather than "it did not reject with X" —
        // which is a different claim, and a misleading one when the raw error IS
        // the expected type.
        await expect(async () => operation()).rejects.toBeInstanceOf(errorType);
      } catch (error) {
        throw explain(error, message);
      }
    },
  };
}
