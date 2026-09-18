/** How a caller asks for one page of accounts. */
export interface UserQuery {
  /** 1-based page number. */
  page: number;
  /** Maximum records per page. */
  limit: number;
  /** Free-text filter over the fields an administrator can see. */
  search?: string;
}
