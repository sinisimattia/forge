import { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import { MfaEnrollmentDecision, MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { decideMfaEnrollment } from '__FORGE_SCOPE__/core/mfa/policies';
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

const confirmed = (id = 'm-c'): MfaMethod => method(id, true);
const unconfirmed = (id = 'm-u'): MfaMethod => method(id, false);

describe('decideMfaEnrollment', () => {
  it('allows the first factor, which has nothing to prove with', () => {
    expect(decideMfaEnrollment([], false)).toBe(MfaEnrollmentDecision.ALLOWED);
  });

  it('allows it when only unconfirmed methods exist', () => {
    // An unconfirmed method is no gate at all, so it cannot produce a proof.
    // Demanding one would make enrollment impossible for an account whose
    // first attempt was abandoned.
    expect(decideMfaEnrollment([unconfirmed()], false)).toBe(MfaEnrollmentDecision.ALLOWED);
  });

  it('demands a proof once a confirmed method exists', () => {
    expect(decideMfaEnrollment([confirmed()], false)).toBe(
      MfaEnrollmentDecision.REAUTHENTICATION_REQUIRED,
    );
  });

  it('demands a proof when an unconfirmed method sits beside a confirmed one', () => {
    expect(decideMfaEnrollment([unconfirmed(), confirmed()], false)).toBe(
      MfaEnrollmentDecision.REAUTHENTICATION_REQUIRED,
    );
  });

  it('allows it when that proof is presented', () => {
    expect(decideMfaEnrollment([confirmed()], true)).toBe(MfaEnrollmentDecision.ALLOWED);
  });

  it('is unmoved by how many confirmed methods there are', () => {
    expect(
      decideMfaEnrollment([confirmed('a'), confirmed('b'), confirmed('c')], false),
    ).toBe(MfaEnrollmentDecision.REAUTHENTICATION_REQUIRED);
  });
});
