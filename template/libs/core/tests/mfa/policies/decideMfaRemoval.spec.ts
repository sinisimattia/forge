import { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import { MfaMethodType, MfaRemovalDecision } from '__FORGE_SCOPE__/core/mfa/enums';
import { decideMfaRemoval } from '__FORGE_SCOPE__/core/mfa/policies';
import type { MfaMethodId } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const method = (id: string, confirmed: boolean): MfaMethod =>
  new MfaMethod({
    id: id as MfaMethodId,
    userId: 'u-1' as UserId,
    type: MfaMethodType.TOTP,
    label: confirmed ? 'A method' : 'Abandoned',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    confirmedAt: confirmed ? new Date('2026-01-02T00:00:00Z') : null,
    lastUsedAt: null,
  });

const confirmedMethod = (id: string): MfaMethod => method(id, true);

describe('decideMfaRemoval', () => {
  it.each([
    ['two confirmed, removing one, no valid proof', 2, false, MfaRemovalDecision.ALLOWED],
    ['two confirmed, removing one, with proof', 2, true, MfaRemovalDecision.ALLOWED],
    ['one confirmed, removing it, no proof', 1, false, MfaRemovalDecision.REAUTHENTICATION_REQUIRED],
    ['one confirmed, removing it, with proof', 1, true, MfaRemovalDecision.ALLOWED],
  ])('%s → %s', (_name, confirmedCount, proofPresented, expected) => {
    const methods = Array.from({ length: confirmedCount }, (_unused, i) => confirmedMethod(`m-${i}`));
    const [removed] = methods;
    expect(decideMfaRemoval(methods, removed.id, proofPresented)).toBe(expected);
  });

  // Review round 1, Important. An unconfirmed method was never a gate —
  // decideAuthenticationStep already treats one as costing nothing (spec §3.1)
  // — so removing it must not demand a proof its owner has no way to produce
  // (spec §4.2, §11.2). Before the fix, the first row here fails: with no
  // confirmed method anywhere, decideMfaRemoval fell through to the
  // no-confirmed-method-survives branch and demanded a proof forever.
  it.each([
    ['unconfirmed method, the account\'s only method, no proof', [false], 0, MfaRemovalDecision.ALLOWED],
    ['unconfirmed method, alongside a confirmed one, no proof', [false, true], 0, MfaRemovalDecision.ALLOWED],
  ])('%s → %s', (_name, confirmedFlags, removedIndex, expected) => {
    const methods = confirmedFlags.map((confirmed, i) => method(`m-${i}`, confirmed));
    expect(decideMfaRemoval(methods, methods[removedIndex].id, false)).toBe(expected);
  });

  // An unconfirmed method never counts as "another confirmed method remains":
  // it cannot be used to satisfy REQUIRE_SECOND_FACTOR, so its presence must
  // not relax the reauthentication requirement for removing the last real one.
  it('does not count an unconfirmed method as a surviving confirmed one', () => {
    const confirmed = confirmedMethod('m-confirmed');
    const unconfirmed = new MfaMethod({
      id: 'm-unconfirmed' as MfaMethodId,
      userId: 'u-1' as UserId,
      type: MfaMethodType.TOTP,
      label: 'Abandoned',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      confirmedAt: null,
      lastUsedAt: null,
    });
    const decision = decideMfaRemoval([confirmed, unconfirmed], confirmed.id, false);
    expect(decision).toBe(MfaRemovalDecision.REAUTHENTICATION_REQUIRED);
  });
});
