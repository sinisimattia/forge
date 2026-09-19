import type { ConformanceExpect } from '__FORGE_SCOPE__/core/shared/testing';
import { adaptJestToConformanceExpect } from '../adapt-jest';

/**
 * The adapter that lets jest drive core's conformance suites.
 *
 * ## Why this file exists at all
 *
 * The adapter is three small methods and it would be easy to call it too
 * trivial to test. The thing it actually has to get right is invisible in a
 * green conformance run and only shows up in a red one: **the `message` every
 * `ConformanceExpect` method takes as its third argument.** Every adapter
 * written for this surface before the rule was noticed dropped it, and the
 * consequence was that a failing precondition inside a shared suite reported
 * `expect(received).toBeTruthy() / Received: false` at a line number in
 * `libs/core` — instead of "the world must seed the actor from an address the
 * domain has to normalize", which is the sentence that says what to fix.
 *
 * A conformance run that passes cannot tell you whether the messages survive.
 * That is precisely why they are asserted here, on purpose and directly: a
 * property nothing exercises is a property nobody has.
 *
 * The suite drives the adapter through its declared interface rather than
 * through the concrete return type, so a method added to `ConformanceExpect` and
 * not to the adapter is a compile error in this file.
 */
describe('adaptJestToConformanceExpect', () => {
  let subject: ConformanceExpect;

  beforeEach(() => {
    subject = adaptJestToConformanceExpect();
  });

  /** What was thrown, or `null` when nothing was. */
  const thrownBy = (body: () => void): Error | null => {
    try {
      body();
      return null;
    } catch (error) {
      return error as Error;
    }
  };

  /** The async form of {@link thrownBy}. */
  const rejectedBy = async (body: () => Promise<void>): Promise<Error | null> => {
    try {
      await body();
      return null;
    } catch (error) {
      return error as Error;
    }
  };

  describe('ok', () => {
    it('passes a truthy value through', () => {
      expect(thrownBy(() => subject.ok('anything', 'unused'))).toBeNull();
    });

    // The message IS the failure here. Jest's own account of a falsy value —
    // `Received: false` — tells a reader nothing they cannot see, so the
    // adapter raises the sentence rather than decorating the matcher with it.
    it('raises the suite\'s message, and nothing else, for a falsy value', () => {
      const raised = thrownBy(() => subject.ok(false, 'the world must seed a normalizable address'));
      expect(raised?.message).toBe('the world must seed a normalizable address');
    });

    // The fallback. Something has to be thrown when the suite passed no
    // sentence, and it is jest's, so the failure still names the matcher.
    it('falls back to the matcher when the suite passed no message', () => {
      const raised = thrownBy(() => subject.ok(false));
      expect(raised?.message).toContain('toBeTruthy');
      expect(raised?.message).not.toContain('undefined\n\n');
    });
  });

  describe('equal', () => {
    it('passes equal values through', () => {
      expect(thrownBy(() => subject.equal(7, 7, 'unused'))).toBeNull();
    });

    // Both halves, and both are wanted: the sentence says what the property is,
    // jest's text says which two values broke it. An adapter that threw only the
    // sentence would lose the diff; one that threw only the diff is the bug this
    // whole file is about.
    it('prefixes the suite\'s message to jest\'s diff', () => {
      const raised = thrownBy(() => subject.equal('got', 'wanted', 'the id must cross unchanged'));
      expect(raised?.message.startsWith('the id must cross unchanged\n\n')).toBe(true);
      expect(raised?.message).toContain('"wanted"');
      expect(raised?.message).toContain('"got"');
    });

    it('leaves jest\'s diff alone when the suite passed no message', () => {
      const raised = thrownBy(() => subject.equal('got', 'wanted'));
      expect(raised?.message).toContain('"wanted"');
      expect(raised?.message.startsWith('undefined')).toBe(false);
    });
  });

  describe('rejects', () => {
    class Expected extends Error {}
    class Unexpected extends Error {}

    it('accepts an operation that rejects with the wanted type', async () => {
      const raised = await rejectedBy(
        () => subject.rejects(() => Promise.reject(new Expected()), Expected, 'unused'),
      );
      expect(raised).toBeNull();
    });

    // The reason the operation is wrapped in `async () => operation()` rather
    // than invoked into `expect(...)`. A `throw` before the first `await` is
    // synchronous, so `expect(operation())` would never be reached and the raw
    // error would escape — reported as an unexpected failure even though it is
    // exactly the error the suite asked for.
    it('accepts an operation that throws synchronously with the wanted type', async () => {
      const raised = await rejectedBy(() => subject.rejects(
        () => {
          throw new Expected();
        },
        Expected,
        'unused',
      ));
      expect(raised).toBeNull();
    });

    it('prefixes the suite\'s message when the wrong error arrives', async () => {
      const raised = await rejectedBy(() => subject.rejects(
        () => Promise.reject(new Unexpected()),
        Expected,
        'a verification token is single-use',
      ));
      expect(raised?.message.startsWith('a verification token is single-use\n\n')).toBe(true);
    });

    it('prefixes the suite\'s message when nothing is thrown at all', async () => {
      const raised = await rejectedBy(
        () => subject.rejects(() => Promise.resolve(), Expected, 'it must refuse'),
      );
      expect(raised?.message.startsWith('it must refuse\n\n')).toBe(true);
    });
  });
});
