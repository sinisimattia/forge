import { IsNotEmpty, IsString } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/** A deliberate secret change, proving the current secret first. */
export class ChangePasswordDto {
  /** The secret they hold now, as proof it is them and not a borrowed session. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  currentSecret!: string;

  /** The replacement. Judged against the deployment's policy, in the service. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  newSecret!: string;
}
