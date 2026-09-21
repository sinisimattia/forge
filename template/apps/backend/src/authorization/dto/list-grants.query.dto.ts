import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * How a caller asks for one page of an organization's grants.
 *
 * Page and limit and nothing else, matching core's own `GrantQuery` exactly —
 * that type's own TSDoc explains why it carries no filter: one would be a
 * claim about behavior no suite could fail. Declared on its own rather than
 * extending `PaginationQueryDto`, the same choice every other query DTO in
 * this backend makes, so that everything an endpoint accepts is visible
 * without following an `extends`.
 */
export class ListGrantsQueryDto {
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
}
