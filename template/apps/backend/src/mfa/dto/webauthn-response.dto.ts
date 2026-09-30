import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { AuthResponseDto } from '../../auth/dto';

/** What `POST /mfa/webauthn/verify` returns for an enrollment. */
export interface WebAuthnEnrollmentResponseDto {
  /** The passkey now on the account, confirmed. Carries no credential material. */
  method: MfaMethodJSON;
  /**
   * The account's first batch of recovery codes when this passkey was its
   * first confirmed method, and `null` when it already had one — the shape
   * `ConfirmTotpResponseDto` has, and shown once for the same reason.
   */
  recoveryCodes: readonly string[] | null;
}

/**
 * What `POST /mfa/webauthn/verify` returns: a registered passkey, or a
 * finished sign-in.
 *
 * Two shapes on one route, because the route serves two ceremonies. Which one
 * a caller gets is decided by the credential their request carried and is
 * therefore already known to them before they send it — see `webAuthnCallerOf`.
 */
export type WebAuthnVerifyResponseDto = WebAuthnEnrollmentResponseDto | AuthResponseDto;
