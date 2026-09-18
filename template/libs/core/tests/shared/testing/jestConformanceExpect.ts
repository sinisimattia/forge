import type { ConformanceExpect } from '__FORGE_SCOPE__/core/shared/testing';
import { explain } from '__FORGE_SCOPE__/core/shared/testing';

/**
 * Adapts jest's assertions to the runner-agnostic surface every conformance suite in
 * this package is driven through.
 *
 * The optional message is part of that surface, and a host that drops it turns "the
 * world must seed the password identity in a form the domain has to normalize" into
 * `Received: false` at a line number — an unreadable failure gets worked around rather
 * than fixed. Jest accepts at most one argument to `expect`, so the message is raised as
 * the failure itself where jest's own report says nothing a reader needs (`ok`), and put
 * in front of it by the shared `explain` helper where the diff is worth keeping.
 *
 * One copy rather than one per spec. This package has exactly one runner, so an adapter
 * per suite is the same twenty lines four times over — and four places for the message
 * contract to be dropped again, which is how it came to be dropped everywhere the first
 * time.
 */
export const jestConformanceExpect: ConformanceExpect = {
  equal: (actual, expected, message) => {
    try {
      expect(actual).toBe(expected);
    } catch (error) {
      throw explain(error, message);
    }
  },
  ok: (value, message) => {
    if (!value && message !== undefined) throw new Error(message);
    expect(value).toBeTruthy();
  },
  rejects: async (operation, errorType, message) => {
    try {
      await expect(operation()).rejects.toBeInstanceOf(errorType);
    } catch (error) {
      throw explain(error, message);
    }
  },
};

// Built from a char code rather than written into the literal: `no-control-regex`
// forbids a control character in a regex, and an escape sequence is exactly that.
const ESCAPE = String.fromCharCode(27);
const COLOUR = new RegExp(`${ESCAPE}\\[[0-9;]*m`, 'g');

/**
 * Jest's own report with its colour removed.
 *
 * Any assertion *about* that report has to read it this way. Jest colours its output
 * when the runner gives it a terminal to write to and not when it is run bare, so
 * `Expected: 2` is `Expected: <esc>[32m2<esc>[39m` under the task runner and plain under
 * `jest` — an assertion matching the plain form passes locally and fails in CI, which is
 * precisely what it did.
 *
 * @param message - a failure message as jest produced it
 * @returns the same text with every colour escape removed
 */
export function plain(message: string): string {
  return message.replace(COLOUR, '');
}
