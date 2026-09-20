import type { OrgRole } from '../enums/OrgRole';

/** How a caller asks for one page of an organization's memberships. */
export interface MemberQuery {
  /** 1-based page number. */
  page: number;
  /** Maximum records per page. */
  limit: number;
  /** Restricts the page to members holding this role, when given. */
  role?: OrgRole;
}
