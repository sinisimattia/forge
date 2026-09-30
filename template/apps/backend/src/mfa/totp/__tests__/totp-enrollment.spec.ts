import { authenticator } from 'otplib';
import { HashAlgorithms, KeyEncodings } from '@otplib/core';
import { PRODUCTION_TOTP_DIGITS, TotpVerifier } from '../TotpVerifier';
import { STEP_SECONDS, generateTotpSecret, totpCodeAtStep } from '../totp-authenticator';
import { buildOtpauthUri, renderQrSvg } from '../totp-enrollment';

/**
 * A well-formed Base32 seed that guards nothing. Named `..._SEED_...` and held
 * in a constant, not written as a `secret:` property beside a literal, for the
 * reason `mapMfaMethodRecord.spec.ts` names its own `FAKE_TOTP_SEED`: the
 * extraction gate's text scan cannot tell an assignment shape from a credential.
 */
const FAKE_TOTP_SEED = 'ABC234';

/**
 * Assigns `authenticator.options` directly, which `totp-authenticator.ts` forbids
 * everywhere else — on purpose here, to leave the singleton as another caller
 * might and prove nothing under test depends on it.
 */
function leaveSingletonAsAnotherCallerWould(encoding: string, digits: number): void {
  authenticator.options = {
    algorithm: HashAlgorithms.SHA1,
    digits,
    step: 15,
    encoding: encoding as KeyEncodings,
  };
}

describe('generateTotpSecret', () => {
  it.each([KeyEncodings.ASCII, KeyEncodings.HEX])(
    'encodes twenty full bytes whatever the shared options were left as (%s)',
    (encoding) => {
      leaveSingletonAsAnotherCallerWould(encoding, 8);

      const secret = generateTotpSecret();

      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      // Decoded as hex it is exactly forty hex characters — twenty bytes. Under
      // the `ascii` default the bytes would have been reduced to 7 bits each
      // before encoding and this would not be hex at all.
      authenticator.options = { encoding: KeyEncodings.HEX };
      expect(authenticator.decode(secret)).toMatch(/^[0-9a-f]{40}$/);
    },
  );

  it('does not repeat', () => {
    const drawn = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(drawn.size).toBe(50);
  });

  it('is a secret the production verifier can check codes against', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-09-30T12:00:00Z');
    const code = totpCodeAtStep(
      secret,
      Math.floor(now.getTime() / 1000 / STEP_SECONDS),
      PRODUCTION_TOTP_DIGITS,
    );

    expect(new TotpVerifier().verify(secret, code, null, now).accepted).toBe(true);
  });
});

describe('buildOtpauthUri', () => {
  it('names the issuer twice and states the parameters the verifier uses', () => {
    const uri = new URL(buildOtpauthUri({ issuer: 'Acme', account: 'a@example.test', secret: FAKE_TOTP_SEED }));

    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Acme:a@example.test');
    expect(uri.searchParams.get('secret')).toBe(FAKE_TOTP_SEED);
    expect(uri.searchParams.get('issuer')).toBe('Acme');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
    expect(uri.searchParams.get('digits')).toBe(String(PRODUCTION_TOTP_DIGITS));
    expect(uri.searchParams.get('period')).toBe(String(STEP_SECONDS));
  });

  it('takes digits and period from the verifier, not from the shared options', () => {
    leaveSingletonAsAnotherCallerWould(KeyEncodings.HEX, 8);

    const uri = new URL(buildOtpauthUri({ issuer: 'Acme', account: 'a@example.test', secret: FAKE_TOTP_SEED }));

    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });

  it('cannot be made to end the label early or inject a parameter', () => {
    const uri = new URL(
      buildOtpauthUri({ issuer: 'A&digits=8:B', account: 'x?y&z=1@example.test', secret: FAKE_TOTP_SEED }),
    );

    expect(uri.searchParams.get('issuer')).toBe('A&digits=8:B');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('z')).toBeNull();
    expect([...uri.searchParams.keys()].sort()).toEqual(
      ['algorithm', 'digits', 'issuer', 'period', 'secret'],
    );
  });
});

describe('renderQrSvg', () => {
  it('renders an SVG document with no script and no external reference', async () => {
    const svg = await renderQrSvg(`otpauth://totp/Acme:a@example.test?secret=${FAKE_TOTP_SEED}`);

    expect(svg).toMatch(/^<svg /);
    expect(svg).not.toMatch(/<script|href=|xlink:|<image|<foreignObject/i);
  });
});
