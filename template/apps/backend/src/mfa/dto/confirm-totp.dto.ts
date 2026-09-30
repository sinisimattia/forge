import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/** The proof that finishes an enrollment: a code from the app that scanned the offer. */
export class ConfirmTotpDto {
  /** The `methodId` the enrollment offer carried. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  methodId!: string;

  /** The code the person's app is showing, as they typed it. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  code!: string;
}
