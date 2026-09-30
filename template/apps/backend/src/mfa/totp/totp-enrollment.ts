import { HashAlgorithms } from '@otplib/core';
import { toString as renderQr } from 'qrcode';
import { PRODUCTION_TOTP_DIGITS } from './TotpVerifier';
import { STEP_SECONDS } from './totp-authenticator';

/** What {@link buildOtpauthUri} needs, all of it already decided by the caller. */
export interface OtpauthUriParts {
  /** The name of this deployment as an authenticator app should show it. From configuration. */
  readonly issuer: string;
  /** The account the code is for — the person's address. */
  readonly account: string;
  /** The Base32 shared secret. */
  readonly secret: string;
}

/**
 * The `otpauth://totp/{issuer}:{account}?secret=…&issuer=…` URI authenticator
 * apps read from a QR code (Google's Key URI Format).
 *
 * ## Built by hand, and why not `authenticator.keyuri`
 *
 * `keyuri` takes `digits`, `algorithm` and `step` from the same shared
 * singleton `TotpVerifier` mutates on every call — an RFC-vector run, or any
 * other configuration that ever touches it, would put *its* digit count into a
 * URI handed to a person, and the code their app then showed would never
 * verify. Here all three come from the constants the verifier itself uses
 * ({@link PRODUCTION_TOTP_DIGITS}, {@link STEP_SECONDS}, SHA-1), so the URI
 * and the check cannot disagree, and they are written into the URI rather than
 * left to each app's default so that they are a statement and not an
 * assumption.
 *
 * The issuer appears twice, as the label prefix and as the `issuer` parameter,
 * because apps disagree about which one they read. Both are percent-encoded,
 * so an issuer or an address containing `:`, `&`, `?` or a space cannot end the
 * label early or inject a parameter.
 *
 * @param parts - issuer, account and secret
 * @returns the URI
 */
export function buildOtpauthUri(parts: OtpauthUriParts): string {
  const issuer = encodeURIComponent(parts.issuer);
  const account = encodeURIComponent(parts.account);
  const params = [
    `secret=${encodeURIComponent(parts.secret)}`,
    `issuer=${issuer}`,
    `algorithm=${HashAlgorithms.SHA1.toUpperCase()}`,
    `digits=${PRODUCTION_TOTP_DIGITS}`,
    `period=${STEP_SECONDS}`,
  ];
  return `otpauth://totp/${issuer}:${account}?${params.join('&')}`;
}

/**
 * The URI as a QR code, rendered here as an SVG document so the webapp ships no
 * QR library and no client-side cryptography — it puts a string into an
 * element.
 *
 * `qrcode`'s SVG output is drawn from the URI alone: it contains no script and
 * no external reference. It does contain the secret, as any rendering of the
 * URI must; the caller is responsible for who receives it.
 *
 * @param uri - the `otpauth://` URI to encode
 * @returns a complete `<svg …>` document
 */
export function renderQrSvg(uri: string): Promise<string> {
  return renderQr(uri, { type: 'svg', errorCorrectionLevel: 'M' });
}
