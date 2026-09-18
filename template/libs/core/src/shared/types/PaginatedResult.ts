/**
 * A page of `T` returned by a paginated contract method, alongside the metadata
 * a caller needs to render pagination controls and request further pages.
 */
export interface PaginatedResult<T> {
  data: T[];
  meta: {
    /** Total matching records, not the length of `data`. */
    total: number;
    /** 1-based page number. */
    page: number;
    /** Maximum records per page. */
    limit: number;
    /** `Math.ceil(total / limit)`; 0 when `total` is 0. */
    totalPages: number;
  };
}
