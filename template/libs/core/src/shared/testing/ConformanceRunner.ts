import type { ConformanceExpect } from './ConformanceExpect';

/** The grouping and assertion primitives a conformance suite needs from its host runner. */
export interface ConformanceRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void | Promise<void>): void;
  expect: ConformanceExpect;
}
