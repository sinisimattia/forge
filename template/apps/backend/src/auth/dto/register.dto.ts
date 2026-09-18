import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/**
 * What a person supplies to bring an account into being.
 *
 * **The password policy is deliberately not expressed here.** It lives in
 * `__FORGE_SCOPE__/core`'s `DEFAULT_PASSWORD_POLICY` and is applied by
 * `AuthService.register` through `evaluatePassword`, which reports *every* way a
 * secret falls short at once. A `@MinLength` here would report the first one and
 * report it in a different response shape, so a person fixing their password
 * would be told one thing at a time — and the deployment that changes its policy
 * would have to remember to change it in two places, one of which is not where
 * the policy is written down.
 *
 * `displayName` carries a length bound and the secret does not, and the
 * asymmetry is on purpose: a display name has no policy anywhere else, so this
 * is the only place its bound can live, whereas the secret's maximum is part of
 * the policy and is enforced twice over — by `evaluatePassword` before anything
 * is spent, and again inside the hasher at the point of spend.
 */
export class RegisterDto {
  /** The address as the person typed it. The domain stores its normal form. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsEmail({}, { message: validationMessage('validation.IS_EMAIL') })
  email!: string;

  /** The name shown to other people. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(200, { message: validationMessage('validation.MAX_LENGTH') })
  displayName!: string;

  /** The password they choose. Judged against the deployment's policy, in the service. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  secret!: string;
}
