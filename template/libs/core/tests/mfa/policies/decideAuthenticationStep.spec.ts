import { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import { MfaMethodType, MfaStep } from '__FORGE_SCOPE__/core/mfa/enums';
import { decideAuthenticationStep } from '__FORGE_SCOPE__/core/mfa/policies';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const method = (confirmed: boolean, type = MfaMethodType.TOTP): MfaMethod =>
  new MfaMethod({
    id: `m-${Math.random()}` as MfaMethodId,
    userId: 'u-1' as UserId,
    type,
    label: 'A method',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    confirmedAt: confirmed ? new Date('2026-01-02T00:00:00Z') : null,
    lastUsedAt: null,
  });

describe('decideAuthenticationStep', () => {
  it.each([
    ['no methods at all', [], MfaStep.ISSUE_SESSION],
    // Review Focus 3. An enrollment somebody abandoned must not lock them out of
    // their own account. Derived from ADR-0012's "only a confirmed method
    // gates", written before the policy.
    ['one method, unconfirmed', [method(false)], MfaStep.ISSUE_SESSION],
    ['several methods, all unconfirmed', [method(false), method(false)], MfaStep.ISSUE_SESSION],
    ['one confirmed method', [method(true)], MfaStep.REQUIRE_SECOND_FACTOR],
    ['one confirmed among unconfirmed', [method(false), method(true)], MfaStep.REQUIRE_SECOND_FACTOR],
    ['a confirmed WebAuthn method alone', [method(true, MfaMethodType.WEBAUTHN)], MfaStep.REQUIRE_SECOND_FACTOR],
  ])('%s → %s', (_name, methods, expected) => {
    expect(decideAuthenticationStep(methods).step).toBe(expected);
  });

  it('returns only the confirmed methods, so a client never prompts for one that cannot be used', () => {
    const confirmed = method(true);
    const decision = decideAuthenticationStep([method(false), confirmed]);
    expect(decision.step).toBe(MfaStep.REQUIRE_SECOND_FACTOR);
    if (decision.step !== MfaStep.REQUIRE_SECOND_FACTOR) throw new Error('unreachable');
    expect(decision.methods).toEqual([confirmed]);
  });
});
