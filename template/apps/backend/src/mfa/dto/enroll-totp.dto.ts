import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/** The most a label may hold — long enough for a description, short enough for a list row. */
export const MFA_LABEL_MAX_LENGTH = 64;

/** A request to start enrolling an authenticator app. */
export class EnrollTotpDto {
  /**
   * What the person calls this method, so they can tell it from another of the
   * same kind. A label of only whitespace passes here and is refused by the
   * domain (`MfaLabelRequiredError`), which is the one place that trims.
   */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(MFA_LABEL_MAX_LENGTH, { message: validationMessage('validation.MAX_LENGTH') })
  label!: string;
}
