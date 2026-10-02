import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * How a caller asks for one page of their own organizations.
 *
 * Declared on its own rather than extending `PaginationQueryDto` — the same
 * choice `ListUsersQueryDto` and `AuditQueryDto` make, and for the reason
 * `CLAUDE.md` gives: `forbidNonWhitelisted` is global, so every field an
 * endpoint accepts has to be visible in one place. This DTO happens to carry
 * only `page` and `limit` today; declaring it this way rather than by
 * extension means a filter added to `OrganizationQuery` later lands here
 * without first undoing an inheritance relationship.
 */
export class ListOrganizationsQueryDto {
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
}
