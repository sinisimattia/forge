import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { validationMessage } from '../../common/i18n';
import { MFA_LABEL_MAX_LENGTH } from './enroll-totp.dto';
import { MfaProofDto } from './mfa-proof.dto';

/**
 * One request to `POST /mfa/webauthn/options`.
 *
 * **There is no `purpose` field, and there must never be one.** Which ceremony
 * this is was decided by the credential the request carried — a session is an
 * enrollment, a challenge token is a login — before this body was read at all.
 * See `webAuthnCallerOf`. A `purpose` here would be the caller choosing which
 * branch runs, which is the authentication bypass `MfaChallengePurpose`'s own
 * TSDoc recounts, in its original and easiest form.
 *
 * `challengeToken` is therefore **not** "which ceremony to run". It is the
 * login credential itself, and its presence alongside an `Authorization`
 * header is refused rather than resolved.
 */
export class WebAuthnOptionsDto {
  /**
   * The challenge `POST /auth/login` returned, for a login. Absent for an
   * enrollment, which carries a session instead.
   *
   * Optional in validation, because a request with neither credential and a
   * request with both are both refused by the controller with the one answer
   * this endpoint gives, and a `422` from here would be a second, more
   * informative one.
   */
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  challengeToken?: string;
}

/**
 * One request to `POST /mfa/webauthn/verify`.
 *
 * Carries `response` — what `navigator.credentials.create()` or `.get()`
 * produced, as `@simplewebauthn/browser` serialises it — and nothing that
 * chooses a code path. It is validated as an object and no further: its shape
 * is `@simplewebauthn/server`'s to check, and a second, partial description of
 * it here would be one that drifts from the library's and refuses what the
 * library accepts.
 */
export class WebAuthnVerifyDto extends WebAuthnOptionsDto {
  /** The authenticator's answer, verbatim. */
  @IsObject({ message: validationMessage('validation.IS_OBJECT') })
  response!: Record<string, unknown>;

  /**
   * What the person calls this passkey, on an enrollment. Ignored on a login,
   * which registers nothing.
   *
   * A label of only whitespace passes here and is refused by the domain
   * (`MfaLabelRequiredError`), which is the one place that trims — the
   * arrangement `EnrollTotpDto` already has.
   */
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(MFA_LABEL_MAX_LENGTH, { message: validationMessage('validation.MAX_LENGTH') })
  label?: string;

  /**
   * A fresh proof of a second factor the account **already holds**, on an
   * enrollment. Owed only when the account already has a confirmed method.
   * Ignored on a login, which is not adding a factor to anything.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => MfaProofDto)
  proof?: MfaProofDto;
}
