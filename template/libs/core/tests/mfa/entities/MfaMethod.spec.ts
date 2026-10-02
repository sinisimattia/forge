import { MfaMethod } from '__FORGE_SCOPE__/core/mfa/entities';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { MfaLabelRequiredError } from '__FORGE_SCOPE__/core/mfa/errors';
import type { MfaMethodId, MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const base = {
  id: 'm-1' as MfaMethodId,
  userId: 'u-1' as UserId,
  type: MfaMethodType.TOTP,
  label: 'Phone',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  confirmedAt: null,
  lastUsedAt: null,
};

const baseJSON: MfaMethodJSON = {
  id: 'm-1' as MfaMethodId,
  userId: 'u-1' as UserId,
  type: MfaMethodType.TOTP,
  label: 'Phone',
  createdAt: '2026-01-01T00:00:00.000Z',
  confirmedAt: null,
  lastUsedAt: null,
};

describe('MfaMethod', () => {
  it('trims the label and keeps the six facts it is given', () => {
    const method = new MfaMethod({ ...base, label: '  Phone  ' });
    expect(method.label).toBe('Phone');
    expect(method.type).toBe(MfaMethodType.TOTP);
    expect(method.confirmedAt).toBeNull();
  });

  it('refuses a label that is absent or only whitespace', () => {
    expect(() => new MfaMethod({ ...base, label: '   ' })).toThrow(MfaLabelRequiredError);
  });

  it('is unconfirmed until it has an instant', () => {
    expect(new MfaMethod(base).isConfirmed()).toBe(false);
    expect(new MfaMethod({ ...base, confirmedAt: new Date() }).isConfirmed()).toBe(true);
  });

  // The property the whole entity exists to have: a method records *which*
  // second factor an account holds and never the material that answers it,
  // which lives in the store behind `IMfaService` and nowhere a domain entity
  // can serialize it. Derived from that requirement, not from the
  // implementation: this assertion was written before
  // MfaMethod.ts existed, and it is what stops a later "just add the secret here"
  // from being a one-line change nobody notices.
  it('has no field that could hold secret material, in any serialization', () => {
    const json = JSON.stringify(new MfaMethod({ ...base, confirmedAt: new Date() }).toJSON());
    for (const forbidden of ['secret', 'publicKey', 'privateKey', 'credential', 'seed', 'counter']) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(new MfaMethod(base))).toEqual(
      ['id', 'userId', 'type', 'label', 'createdAt', 'confirmedAt', 'lastUsedAt'],
    );
  });

  describe('fromJSON', () => {
    it('revives the instants as dates', () => {
      const method = MfaMethod.fromJSON({
        ...baseJSON,
        createdAt: '2026-03-04T05:06:07.000Z',
        confirmedAt: '2026-03-05T05:06:07.000Z',
        lastUsedAt: '2026-04-05T06:07:08.000Z',
      });
      expect(method.createdAt).toEqual(new Date('2026-03-04T05:06:07.000Z'));
      expect(method.confirmedAt).toEqual(new Date('2026-03-05T05:06:07.000Z'));
      expect(method.lastUsedAt).toEqual(new Date('2026-04-05T06:07:08.000Z'));
    });

    it('revives an unconfirmed, never-used method with null instants', () => {
      const method = MfaMethod.fromJSON({ ...baseJSON, confirmedAt: null, lastUsedAt: null });
      expect(method.confirmedAt).toBeNull();
      expect(method.lastUsedAt).toBeNull();
      expect(method.isConfirmed()).toBe(false);
    });

    it('re-runs every invariant, so a row carrying a blank label is rejected', () => {
      expect(() => MfaMethod.fromJSON({ ...baseJSON, label: '   ' })).toThrow(MfaLabelRequiredError);
    });

    it('carries every field of a row back out through toJSON', () => {
      const json: MfaMethodJSON = {
        id: 'method-7' as MfaMethodId,
        userId: 'user-7' as UserId,
        type: MfaMethodType.WEBAUTHN,
        label: 'Security key',
        createdAt: '2026-05-06T07:08:09.000Z',
        confirmedAt: '2026-05-06T07:09:10.000Z',
        lastUsedAt: '2026-06-07T08:09:10.000Z',
      };
      expect(MfaMethod.fromJSON(json).toJSON()).toEqual(json);
    });
  });
});
