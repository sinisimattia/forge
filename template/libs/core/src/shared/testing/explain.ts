/**
 * Wraps an assertion failure with the message the suite passed, so a failure says what
 * was wrong rather than only which line noticed.
 *
 * {@link ConformanceExpect} declares an optional `message` on every assertion, and a host
 * whose adapter drops it turns "the world must seed the actor from an address the domain
 * has to normalize" into `Received: false` at a line number. Every host needs the same
 * three lines to honour it, so they live here rather than in each driver: a runner-
 * agnostic helper, because all it does is put a message in front of an error's own text.
 *
 * Two deliberate limits, both worth knowing and neither worth engineering around:
 *
 * - A throw that is not an `Error` yields `message\n\nundefined`, because there is nothing
 *   better to read off it. The message — the part a reader needs — still arrives.
 * - The returned `Error` is a plain one, so a runner-specific payload on the original
 *   (jest's `matcherResult`, which carries the structured diff) does not survive. The
 *   diff's *text* does, because it is part of the message this wraps.
 *
 * @param error - whatever the assertion threw
 * @param message - the suite's explanation, or `undefined` to pass the failure through
 * @returns the error to throw: the original when there is no message, else a wrapper
 */
export function explain(error: unknown, message: string | undefined): Error {
  if (message === undefined) return error as Error;
  return new Error(`${message}\n\n${(error as Error).message}`);
}
