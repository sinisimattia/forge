import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { validationMessage } from '../../common/i18n';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * How a caller asks for one page of an organization's memberships.
 *
 * Declared on its own rather than extending `PaginationQueryDto`, for the
 * reason `ListOrganizationsQueryDto` gives: `forbidNonWhitelisted` is global,
 * so every field an endpoint accepts has to be visible in one place.
 */
export class ListMembersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @ApiPropertyOptional()
  readonly page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional()
  readonly limit: number = 20;

  /** Restricts the page to members holding this role, when given. */
  @IsOptional()
  @IsEnum(OrgRole, { message: validationMessage('validation.IS_ENUM') })
  readonly role?: OrgRole;
}
