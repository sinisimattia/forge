import { buildWebAuthnConfig } from '../webauthn.config';

const RP_ID = 'app.example';
const ORIGIN = 'https://app.example';

describe('buildWebAuthnConfig', () => {
  it('is absent when nothing is configured', () => {
    expect(buildWebAuthnConfig({})).toBeNull();
  });

  it('is absent, not partly built, when the relying-party variables are set but the flag is not', () => {
    expect(buildWebAuthnConfig({
      MFA_WEBAUTHN_RP_ID: RP_ID,
      MFA_WEBAUTHN_ORIGIN: ORIGIN,
    })).toBeNull();
  });

  // The flag is read by explicit comparison against 'true'. An environment
  // variable read as a raw string makes every value except the empty one
  // truthy, so "false" would enable the thing it names — the defect
  // OAUTH_DEV_ENABLED shipped once. The env below is otherwise complete, so the
  // only thing that can turn each row off is the parse of the flag itself.
  it.each([
    ['false', null],
    ['0', null],
    ['', null],
    ['true', 'object'],
    ['1', 'object'],
  ])('reads MFA_WEBAUTHN_ENABLED=%j as a boolean, not a string', (value, expected) => {
    const result = buildWebAuthnConfig({
      MFA_WEBAUTHN_ENABLED: value,
      MFA_WEBAUTHN_RP_ID: RP_ID,
      MFA_WEBAUTHN_ORIGIN: ORIGIN,
    });
    if (expected === null) {
      expect(result).toBeNull();
    } else {
      expect(typeof result).toBe(expected);
      expect(result).not.toBeNull();
    }
  });

  // The dangerous direction for this flag is off: "yes" silently ignored would
  // leave an operator believing a second factor exists. An unmodelled spelling
  // is a test case, not a fallthrough.
  it.each(['yes', 'on', 'TRUE', 'True', ' true', 'true ', 'no', 'enabled'])(
    'refuses to boot on the unrecognised MFA_WEBAUTHN_ENABLED=%j',
    (value) => {
      expect(() => buildWebAuthnConfig({
        MFA_WEBAUTHN_ENABLED: value,
        MFA_WEBAUTHN_RP_ID: RP_ID,
        MFA_WEBAUTHN_ORIGIN: ORIGIN,
      })).toThrow(/MFA_WEBAUTHN_ENABLED is set to/);
    },
  );

  it('refuses to boot when enabled without an RP ID', () => {
    expect(() => buildWebAuthnConfig({
      MFA_WEBAUTHN_ENABLED: 'true',
      MFA_WEBAUTHN_ORIGIN: ORIGIN,
    })).toThrow(/MFA_WEBAUTHN_RP_ID/);
  });

  it('refuses to boot when enabled without an origin', () => {
    expect(() => buildWebAuthnConfig({
      MFA_WEBAUTHN_ENABLED: 'true',
      MFA_WEBAUTHN_RP_ID: RP_ID,
    })).toThrow(/MFA_WEBAUTHN_ORIGIN/);
  });

  it('treats an empty relying-party variable as missing', () => {
    expect(() => buildWebAuthnConfig({
      MFA_WEBAUTHN_ENABLED: 'true',
      MFA_WEBAUTHN_RP_ID: '',
      MFA_WEBAUTHN_ORIGIN: ORIGIN,
    })).toThrow(/MFA_WEBAUTHN_RP_ID/);
  });

  it('names every missing variable when both are missing', () => {
    expect(() => buildWebAuthnConfig({ MFA_WEBAUTHN_ENABLED: 'true' }))
      .toThrow(/MFA_WEBAUTHN_RP_ID.*MFA_WEBAUTHN_ORIGIN/s);
  });

  it('returns the relying party, its origin and a display name when fully configured', () => {
    expect(buildWebAuthnConfig({
      MFA_WEBAUTHN_ENABLED: 'true',
      MFA_WEBAUTHN_RP_ID: RP_ID,
      MFA_WEBAUTHN_ORIGIN: ORIGIN,
      MFA_ISSUER: 'Acme',
    })).toEqual({ rpId: RP_ID, rpName: 'Acme', origin: ORIGIN });
  });

  it('falls back to the RP ID as the display name when no issuer is set', () => {
    expect(buildWebAuthnConfig({
      MFA_WEBAUTHN_ENABLED: 'true',
      MFA_WEBAUTHN_RP_ID: RP_ID,
      MFA_WEBAUTHN_ORIGIN: ORIGIN,
    })?.rpName).toBe(RP_ID);
  });
});
