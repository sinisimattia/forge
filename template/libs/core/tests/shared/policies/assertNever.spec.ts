import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';

describe('assertNever', () => {
  it('throws, naming the value that escaped the switch', () => {
    expect(() => assertNever('UNHANDLED' as never)).toThrow(/UNHANDLED/);
  });

  it('refuses a value the compiler has not narrowed to never', () => {
    type Status = 'A' | 'B';
    const status = 'A' as Status;
    expect(() => {
      // @ts-expect-error — `assertNever` accepts only `never`. A union member
      // that has not been narrowed away is a COMPILE error, and that is the
      // whole guarantee: adding a branch to a union turns every switch that
      // does not handle it into a build failure. `@ts-expect-error` fails the
      // typecheck if that error stops occurring, so this assertion is enforced
      // by `nx typecheck core`, not just by the runtime throw below.
      assertNever(status);
    }).toThrow(/A/);
  });
});
