import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/** An address somebody wants a fresh verification link sent to. */
export class ResendVerificationDto {
  /**
   * The address as the person typed it.
   *
   * **Validated as a string and not as an address**, for the reason
   * `ForgotPasswordDto` gives at length: this endpoint answers every request the
   * same way, and `@IsEmail` would give it a second answer shape that only some
   * inputs reach. This is the third of the three endpoints that take an address
   * without proving anything, and all three have to answer alike.
   */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  email!: string;
}
