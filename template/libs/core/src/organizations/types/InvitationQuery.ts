import type { InvitationStatus } from '../enums/InvitationStatus';

/** How a caller asks for one page of an organization's invitations. */
export interface InvitationQuery {
  /** 1-based page number. */
  page: number;
  /** Maximum records per page. */
  limit: number;
  /** Restricts the page to invitations in this status, when given. */
  status?: InvitationStatus;
}
