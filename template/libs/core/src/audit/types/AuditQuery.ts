import type { OrganizationId } from '../../organizations/types/OrganizationId';
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
   * An omitted filter does not narrow. An explicit `null` narrows to the entries
   * that belong to no tenant — platform-level events like a sign-in, which
   * happens before any organization is in play. Those are different questions and
   * the suite now asserts both, which it could not do in Phase 2 because no world
   * it could build held a tenant to tell apart.
   */
  organizationId?: OrganizationId | null;
  /** Only entries this person is recorded as the actor of. */
  actorId?: UserId;
  /** Only entries recording this kind of action. */
  action?: AuditAction;
  /**
   * Only entries that had already happened at this instant.
   *
   * **An upper bound on the window, and the only thing that makes paging
   * through this table stable.** Every other filter narrows *what* is returned;
   * this one fixes *when* the list was taken. Without it, `page` and `limit` are
   * an offset into a list that grows at the top while a caller is reading it, so
   * each entry recorded between two requests pushes one row from the end of a
   * page onto the start of the next — a row the caller sees twice, and, at the
   * far end, a row they never see at all.
   *
   * That is not a hypothetical concurrent writer. Reading this history is itself
   * an audited action wherever platform administration is the reason it is
   * permitted, so a caller paging through it is the one appending to it. The
   * remedy is for every page of one traversal to carry the same bound: take it
   * from the first response and send it back with each subsequent page.
   *
   * Inclusive, so a bound taken from an entry's own `occurredAt` includes that
   * entry. Instants are supplied by the caller who recorded them
   * ({@link RecordAuditEntryInput}), so two entries can share one and an
   * implementation must keep its own total order within an instant — see the
   * ordering note on {@link IAuditService.query}.
   */
  asOf?: Date;
}
