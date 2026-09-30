import type { MfaMethodId } from './MfaMethodId';

/**
 * What a caller is given to finish enrolling a TOTP method.
 *
 * `secret` and `otpauthUri` say the same thing twice, for two different
 * audiences: `otpauthUri` is what a QR code encodes for an authenticator app
 * to scan, and `secret` is the same shared value spelled out for a person
 * whose app can only take manual entry. `qrSvg` is the rendered form of
 * `otpauthUri`, offered so that no consumer has to carry its own QR-drawing
 * dependency to show the same code a scanner would read from the URI.
 *
 * This is the one place the shared secret ever leaves the implementation
 * that minted it — it exists to be shown once, at enrollment, and never
 * again. {@link MfaMethod} itself holds none of it (see that entity's own
 * TSDoc), which is what keeps a later "just add the secret to the listing"
 * change from being a one-line edit nobody notices.
 */
export interface TotpEnrollmentOffer {
  /** The method this offer will confirm, once a valid code is presented. */
  readonly methodId: MfaMethodId;
  /** The `otpauth://` URI an authenticator app scans to enroll the same secret. */
  readonly otpauthUri: string;
  /** `otpauthUri`, rendered as a scannable SVG. */
  readonly qrSvg: string;
  /** The shared secret itself, for an app that only accepts manual entry. */
  readonly secret: string;
}
