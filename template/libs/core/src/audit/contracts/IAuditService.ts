import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import type { UserId } from '../../users/types/UserId';
import type { AuditEntry } from '../entities/AuditEntry';
import type { AuditQuery } from '../types/AuditQuery';
import type { RecordAuditEntryInput } from '../types/RecordAuditEntryInput';

/**
 * The append-only record of what happened.
 *
 * There is no `update`, no `delete`, no `purge`. The absence is the point: an
 * interface that cannot express a change is one no caller can be talked into
 * making. This is only half of the guarantee, and the weaker half — the other
 * half is a database grant that refuses the statement even if some future code
 * bypasses this interface entirely (D13). A convention that lives only in an
 * interface is a convention; a privilege is a guarantee.
 */
export interface IAuditService {
  /**
   * Records an entry. Never rejects for a business reason: an audit write that
   * could fail a caller's operation would create pressure to make it optional,
   * and an optional audit log is not one.
   *
   * @param input - the entry to record, less the identifier the store assigns
   */
  record(input: RecordAuditEntryInput): Promise<void>;

  /**
   * Reads entries the actor is entitled to see: a platform administrator
   * reads across the deployment, and an organization administrator reads
   * their own organization's entries, which is why {@link AuditQuery} already
   * carries an `organizationId` filter.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param query - which page is wanted, and how to narrow it
   * @returns one page of entries, newest first, with the totals a caller needs
   */
  query(actorId: UserId, query: AuditQuery): Promise<PaginatedResult<AuditEntry>>;
}
