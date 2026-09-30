import type { TotpEnrollmentOffer } from '__FORGE_SCOPE__/core/mfa/types';

/**
 * `POST /mfa/totp/enroll`'s answer: the offer, unchanged.
 *
 * The only response in this API that carries a shared secret, and it carries it
 * three ways — inside `otpauthUri`, inside `qrSvg`, and bare in `secret` for
 * manual entry — because they are the same secret shown to a person in the
 * three forms they might need. It is shown once: nothing else this API returns
 * holds it, and `GET /mfa/methods` has no field it could go in.
 */
export type TotpEnrollmentResponseDto = TotpEnrollmentOffer;

/**
 * `POST /mfa/totp/confirm`'s answer.
 *
 * `recoveryCodes` is the plaintext batch on the confirmation that gave the
 * account its first confirmed method, and `null` on every one after — the codes
 * are minted once for an account and are unrecoverable afterwards, so a client
 * that does not show a non-null value has lost them.
 */
export interface ConfirmTotpResponseDto {
  readonly recoveryCodes: readonly string[] | null;
}

/**
 * `POST /mfa/recovery-codes`'s answer: the new batch in the clear, exactly once.
 *
 * Every code the account held before is gone; a client that does not show these
 * has left the account with codes nobody can read.
 */
export interface RegenerateRecoveryCodesResponseDto {
  readonly recoveryCodes: readonly string[];
}
