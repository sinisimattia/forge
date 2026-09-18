import { jestConformanceExpect, plain } from './jestConformanceExpect';

/** Runs `body`, expecting it to throw, and returns the failure text without colour. */
function failureOf(body: () => unknown): string {
  try {
    body();
  } catch (error) {
    return plain((error as Error).message);
  }
  throw new Error('the assertion under test did not fail');
}

/** The same, for the one assertion on the surface that is asynchronous. */
async function asyncFailureOf(body: () => Promise<unknown>): Promise<string> {
  try {
    await body();
  } catch (error) {
    return plain((error as Error).message);
  }
  throw new Error('the assertion under test did not fail');
}

// `ConformanceExpect` declares an optional `message` on all three assertions, and every
// adapter written before this one silently dropped it — so every explanatory message in
// every conformance suite went to nothing, through two whole domains, and a failing
// precondition guard reported `Received: false` instead of naming the problem. Pinned
// here so that the next adapter cannot quietly do it again: a rule asks, a test enforces.
describe('the jest conformance adapter', () => {
  it('raises the suite\'s message when `ok` fails', () => {
    expect(failureOf(() => {
      jestConformanceExpect.ok(false, 'the world must seed a normalizable value');
    })).toBe('the world must seed a normalizable value');
  });

  it('still fails when `ok` is given no message', () => {
    expect(failureOf(() => {
      jestConformanceExpect.ok(false);
    })).toContain('toBeTruthy');
  });

  it('keeps jest\'s own report underneath the message when `equal` fails', () => {
    expect(failureOf(() => {
      jestConformanceExpect.equal(1, 2, 'the two sides must agree');
    })).toMatch(/the two sides must agree[\s\S]*Expected: 2[\s\S]*Received: 1/);
  });

  it('passes jest\'s report through untouched when `equal` is given no message', () => {
    expect(failureOf(() => {
      jestConformanceExpect.equal(1, 2);
    })).toMatch(/Expected: 2[\s\S]*Received: 1/);
  });

  it('keeps the message when `rejects` sees the wrong kind of failure', async () => {
    const failure = await asyncFailureOf(() => jestConformanceExpect.rejects(
      () => Promise.reject(new TypeError('something else')),
      RangeError,
      'the call must be refused for the documented reason',
    ));
    expect(failure).toContain('the call must be refused for the documented reason');
  });

  it('accepts a rejection of the kind the suite named', async () => {
    await jestConformanceExpect.rejects(
      () => Promise.reject(new RangeError('as documented')),
      RangeError,
      'the call must be refused for the documented reason',
    );
  });
});

// The regex above reads a report that may or may not be wearing colour, depending on
// whether the runner handed jest a terminal. `plain` is what makes the two cases the
// same, and it is asserted rather than trusted because the assertion it protects passed
// under a bare `jest` and failed under the task runner for a whole task without anybody
// seeing it.
describe('plain', () => {
  it('removes the colour jest writes around a value', () => {
    const escape = String.fromCharCode(27);
    expect(plain(`Expected: ${escape}[32m2${escape}[39m`)).toBe('Expected: 2');
  });

  it('leaves text that carries no colour exactly as it was', () => {
    expect(plain('Expected: 2')).toBe('Expected: 2');
  });
});
