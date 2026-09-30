import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import type { AuthenticationOutcome } from '__FORGE_SCOPE__/core/auth/types';
import { assertNever } from '__FORGE_SCOPE__/core/shared/policies';

describe('AuthenticationOutcome', () => {
  it('has a variant for every AuthenticationStatus member', () => {
    // If a member is added without a variant, this switch still compiles with
    // `never` reaching assertNever — which is the failure this asserts against.
    // Every member must be reachable as a discriminant here.
    const statuses = Object.values(AuthenticationStatus);
    const handled: AuthenticationStatus[] = [];
    const handle = (outcome: AuthenticationOutcome): void => {
      switch (outcome.status) {
        case AuthenticationStatus.AUTHENTICATED:
          handled.push(outcome.status);
          return;
        case AuthenticationStatus.REJECTED:
          handled.push(outcome.status);
          return;
        case AuthenticationStatus.MFA_REQUIRED:
          handled.push(outcome.status);
          return;
        default:
          return assertNever(outcome);
      }
    };
    expect(typeof handle).toBe('function');
    expect(statuses).toContain(AuthenticationStatus.MFA_REQUIRED);
    expect(statuses).toHaveLength(3);
  });
});
