import type { UserId } from '../../users/types/UserId';
import type { AuditAction } from '../enums/AuditAction';

/**
 * How a caller asks for one page of the history.
 *
 * Every filter is optional and an omitted filter means "do not narrow by this".
 * Supplying two narrows by both: the conformance suite pins that a query naming
 * an action and an actor that belong to different entries matches neither, so an
 * implementation that treated the filters as alternatives is caught.
 */
export interface AuditQuery {
  /** 1-based page number. */
  page: number;
  /** Maximum records per page. */
  limit: number;
  /**
   * Only entries recorded against this tenant.
   *
   * Declared now because the reason the field exists on the entry at all applies
   * to reading it too: Phase 3 gives organization administrators a view of their
   * own organization's history, and that view is this filter.
   *
   * Its semantics are deliberately not pinned yet, exactly as `UserQuery.search`
   * is not: the conformance suite asserts nothing about it, because no world it
   * can build holds two tenants to tell apart until an organization exists.
   * Anything relying on a particular behaviour — including what an explicit
   * `null` means as against an omitted filter — must first make that behaviour
   * an assertion in `runIAuditServiceContract`, not assume it.
   */
  organizationId?: string | null;
  /** Only entries this person is recorded as the actor of. */
  actorId?: UserId;
  /** Only entries recording this kind of action. */
  action?: AuditAction;
}
