/**
 * The assertion surface a conformance suite is driven through.
 *
 * Suites are runner-agnostic: the same suite runs under one test runner in one
 * package and a different runner in another, because each package adapts its
 * own runner to this interface.
 */
export interface ConformanceExpect {
  /** Asserts strict equality. */
  equal<T>(actual: T, expected: T, message?: string): void;
  /** Asserts the value is truthy. */
  ok(value: unknown, message?: string): void;
  /** Asserts the operation rejects with an instance of `errorType`. */
  rejects(
    operation: () => Promise<unknown>,
    errorType: new (...args: never[]) => Error,
    message?: string,
  ): Promise<void>;
}
