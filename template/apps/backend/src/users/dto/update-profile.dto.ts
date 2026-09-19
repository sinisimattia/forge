import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/**
 * The changes a person may make to their own profile.
 *
 * **The address is not here**, and its absence is the design rather than an
 * omission: changing an address is claiming a new one, and a claim is only worth
 * anything once it has been proven. An account whose address could be changed
 * silently is an account anybody who borrowed a session for a minute could
 * redirect every future recovery mail to.
 *
 * Neither is `status` or `platformRole`. The global validation pipe runs with
 * `forbidNonWhitelisted`, so a request carrying either is refused outright
 * rather than quietly ignored — which is the difference between a caller finding
 * out they cannot promote themselves and a caller believing they did.
 */
export class UpdateProfileDto {
  /** The new name shown to other people. Omit it to leave the name alone. */
  @IsOptional()
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(200, { message: validationMessage('validation.MAX_LENGTH') })
  displayName?: string;
}
