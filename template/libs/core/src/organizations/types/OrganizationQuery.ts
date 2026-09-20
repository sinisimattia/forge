/** How a caller asks for one page of organizations. */
export interface OrganizationQuery {
  /** 1-based page number. */
  page: number;
  /** Maximum records per page. */
  limit: number;
}
