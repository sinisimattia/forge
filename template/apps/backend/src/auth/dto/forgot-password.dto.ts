import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/** An address somebody wants a recovery link sent to. */
export class ForgotPasswordDto {
  /**
   * The address as the person typed it.
   *
   * **Validated as a string and not as an address**, for the reason `LoginDto`
   * gives: this endpoint answers every request the same way, and `@IsEmail`
   * would give it a second answer shape — a 422 with a field-level detail — that
   * only some inputs reach. Nothing about that second shape reveals whether an
   * account exists, but it is one more branch on the one endpoint whose whole
   * design is that it has none, and the next person to add a rule here would be
   * adding it to a method that already looks as though branching is fine.
   */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  email!: string;
}
