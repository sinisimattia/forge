import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/**
 * One attempt to prove that an account belongs to whoever is asking.
 *
 * **`email` is validated as a string and not as an address**, unlike
 * `RegisterDto.email`, and the difference is the point. `@IsEmail` here would
 * answer a malformed address with a 422 carrying a field-level detail, and a
 * registered address with a 401 carrying a fixed message — two distinguishable
 * answers on the one endpoint whose whole design is that every failure looks the
 * same. Something that is not an address simply matches no identity and is
 * rejected like any other wrong guess.
 */
export class LoginDto {
  /** The address as the person typed it. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  email!: string;

  /** The password offered. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  secret!: string;
}
