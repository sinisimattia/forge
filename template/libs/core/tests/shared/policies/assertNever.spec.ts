import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';

describe('assertNever', () => {
  it('throws, naming the value that escaped the switch', () => {
    expect(() => assertNever('UNHANDLED' as never)).toThrow(/UNHANDLED/);
  });

  it('is reachable only through a cast, which is the point', () => {
    // A union with every branch handled leaves `never` at the default, so this
    // compiles. Adding a branch to the union makes the argument no longer `never`
    // and turns this into a compile error at every call site — the reason the
    // helper exists.
    type Status = 'A' | 'B';
    const describeStatus = (status: Status): string => {
      switch (status) {
        case 'A':
          return 'a';
        case 'B':
          return 'b';
        default:
          return assertNever(status);
      }
    };
    expect(describeStatus('A')).toBe('a');
    expect(describeStatus('B')).toBe('b');
  });
});
