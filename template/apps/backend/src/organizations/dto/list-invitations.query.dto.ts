import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { InvitationStatus } from '__FORGE_SCOPE__/core/organizations/enums';
import { validationMessage } from '../../common/i18n';

/**
 * How a caller asks for one page of an organization's invitations.
 *
 * Declared on its own rather than extending `PaginationQueryDto`, for the
 * reason `ListMembersQueryDto` gives: `forbidNonWhitelisted` is global, so
 * every field an endpoint accepts has to be visible in one place.
 */
export class ListInvitationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit: number = 20;

  /** Restricts the page to invitations in this status, when given. */
  @IsOptional()
  @IsEnum(InvitationStatus, { message: validationMessage('validation.IS_ENUM') })
  readonly status?: InvitationStatus;
}
