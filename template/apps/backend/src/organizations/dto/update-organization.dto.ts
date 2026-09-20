import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/**
 * The changes a caller may make to an existing organization.
 *
 * Every field is optional; an omitted field means "leave it alone" — see
 * `UpdateOrganizationInput`. As with `CreateOrganizationDto`, only the cheap
 * checks live here; a blank-after-trim name or an unusable slug is refused by
 * `Organization` itself, once, in core.
 */
export class UpdateOrganizationDto {
  /** The new name shown to its members. Omit it to leave the name alone. */
  @IsOptional()
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(200, { message: validationMessage('validation.MAX_LENGTH') })
  readonly name?: string;

  /** The new path segment identifying the organization. Omit it to leave the slug alone. */
  @IsOptional()
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  @MaxLength(200, { message: validationMessage('validation.MAX_LENGTH') })
  readonly slug?: string;
}
