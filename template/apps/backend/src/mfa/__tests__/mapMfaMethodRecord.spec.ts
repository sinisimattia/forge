import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { MfaMethodRecord } from '../entities/mfa-method-record.entity';
import { mapMfaMethodRecord } from '../mapMfaMethodRecord';

// A fixture value, not a credential — named to say so, since a literal
// assigned to a key matching `*secret*` is indistinguishable from a real one
// to a text scan.
const FAKE_TOTP_SEED = 'JBSWY3DPEHPK3PXP';

const row = (over: Partial<MfaMethodRecord>): MfaMethodRecord =>
  Object.assign(new MfaMethodRecord(), {
    id: 'm-1', userId: 'u-1', type: 'TOTP', label: 'Phone',
    totpSecret: FAKE_TOTP_SEED, totpLastStep: null,
    webauthnCredentialId: null, webauthnPublicKey: null, webauthnCounter: null,
    confirmedAt: null, lastUsedAt: null, createdAt: new Date(),
  }, over);

/**
 * `mapMfaMethodRecord` is the only thing standing between a corrupted
 * `mfa_methods` row and the code that acts on it — `type` is plain `text`
 * with no `CHECK` (see `1758000005000-Mfa.ts`). Every `it.each` case below
 * was constructed to reach the mapper's fallthrough or one of its per-type
 * assertions, exactly the shape a row this migration would accept but no
 * `MfaMethodType` member is, or a row whose material does not match the type
 * it claims.
 */
describe('mapMfaMethodRecord', () => {
  it('maps a well-formed TOTP row', () => {
    expect(mapMfaMethodRecord(row({})).type).toBe(MfaMethodType.TOTP);
  });

  it('maps a well-formed WebAuthn row', () => {
    // Cast for the same reason the `it.each` rows below are: `type` is
    // `MfaMethodType`, a real TS enum, which does not accept the bare string
    // literal a row straight out of a `text` column actually carries.
    const method = mapMfaMethodRecord(row({
      type: 'WEBAUTHN', totpSecret: null,
      webauthnCredentialId: 'cred-1', webauthnPublicKey: 'pk', webauthnCounter: '0',
    } as Partial<MfaMethodRecord>));
    expect(method.type).toBe(MfaMethodType.WEBAUTHN);
  });

  // The fail-closed properties. `type` is plain text with no CHECK — correctly,
  // because every enum-ish column in this schema is — so this mapper is the only
  // thing standing between a corrupted value and the code that acts on it.
  it.each([
    ['a type nothing models', { type: 'SMS' }],
    ['an empty type', { type: '' }],
    ['a TOTP row with no secret', { type: 'TOTP', totpSecret: null }],
    ['a WebAuthn row with no key', { type: 'WEBAUTHN', totpSecret: null, webauthnCredentialId: 'c', webauthnPublicKey: null }],
    ['a WebAuthn row with no id', { type: 'WEBAUTHN', totpSecret: null, webauthnPublicKey: 'pk', webauthnCredentialId: null }],
  ])('refuses %s', (_name, over) => {
    expect(() => mapMfaMethodRecord(row(over as Partial<MfaMethodRecord>))).toThrow();
  });
});
