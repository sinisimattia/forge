import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * How an administrator asks for one page of accounts.
 *
 * `limit` is bounded at 100. Without a ceiling the page size is whatever a
 * caller asks for, and "one page of every account on the deployment" is both a
 * way to read the whole table in one request and a way to make the server build
 * it.
 */
export class ListUsersQueryDto {
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

  /**
   * Free-text filter over the fields an administrator can see.
   *
   * Bounded, because it reaches a query: an unbounded filter is an unbounded
   * pattern for the database to match every row against.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  readonly search?: string;
}
