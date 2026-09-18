import { explain } from '__FORGE_SCOPE__/core/shared/testing';

describe('explain', () => {
  it('passes the failure through untouched when there is no message', () => {
    const failure = new Error('Expected: 0\nReceived: 1');
    expect(explain(failure, undefined)).toBe(failure);
  });

  it('puts the message in front of the failure\'s own text', () => {
    const wrapped = explain(new Error('Expected: 0\nReceived: 1'), 'the two sides must agree');
    expect(wrapped.message).toBe('the two sides must agree\n\nExpected: 0\nReceived: 1');
  });

  // The documented limit, asserted rather than trusted: a non-Error throw has no `message`
  // to read, and the part a reader needs still arrives.
  it('still carries the message when what was thrown is not an Error', () => {
    expect(explain('a bare string', 'the two sides must agree').message).toBe(
      'the two sides must agree\n\nundefined',
    );
  });
});
