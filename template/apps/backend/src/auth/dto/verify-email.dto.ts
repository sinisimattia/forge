import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/** The single-use value delivered to an address, presented back to prove it. */
export class VerifyEmailDto {
  /**
   * The credential as it was delivered.
   *
   * Validated for presence and nothing more. A format rule here would answer
   * differently for a value of the wrong shape than for one of the right shape
   * that names nothing, which tells a guesser what shape to guess in.
   */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  credential!: string;
}
