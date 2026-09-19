import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/** A recovery credential, presented with the secret it is being spent on. */
export class ResetPasswordDto {
  /**
   * The credential as it was delivered.
   *
   * Presence only, for the reason `VerifyEmailDto` gives: a format rule answers
   * a value of the wrong shape differently from one of the right shape that
   * names nothing, which tells a guesser what shape to guess in.
   */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  credential!: string;

  /**
   * The replacement secret.
   *
   * The policy is deliberately not expressed here — it lives in core's
   * `DEFAULT_PASSWORD_POLICY` and is applied by `AuthService.resetPassword`,
   * which reports every way a secret falls short at once. See `RegisterDto` for
   * the whole of that argument; this is the same rule, and it must be the same
   * rule, or a password acceptable at registration is refused at recovery.
   */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  secret!: string;
}
