import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/**
 * What a caller must supply to create an organization.
 *
 * Only the cheap checks live here — non-empty, bounded length. The deeper
 * rule for each field (a name that is nothing but whitespace, a slug that
 * cannot be used in a path) is `Organization`'s own invariant, enforced once
 * in core rather than copied here as a second regex that can drift from it.
 * A blank-after-trim name or an unusable slug therefore surfaces as a domain
 * error from `OrganizationsService`, not as a 400 from this DTO.
 */
export class CreateOrganizationDto {
  /** The name shown to its members. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(200, { message: validationMessage('validation.MAX_LENGTH') })
  readonly name!: string;

  /** The path segment identifying the organization. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(200, { message: validationMessage('validation.MAX_LENGTH') })
  readonly slug!: string;
}
