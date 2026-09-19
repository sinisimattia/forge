import type { RecordAuditEntryInput } from '__FORGE_SCOPE__/core/audit/types';
import type { AuditService } from '../../audit/audit.service';

/**
 * An {@link AuditService} that records what it was asked to write and writes
 * nothing.
 *
 * One helper rather than the same object literal in five specs. That is not only
 * tidiness: `AuditService` grew `recordIn` — the transactional variant an entry
 * needs in order to commit with the thing it describes — and five hand-written
 * stubs meant five places to discover that, one 500 at a time. A service gaining
 * a method is now one edit here, and every spec that uses this gets it.
 *
 * Both members push into the same array on purpose. A caller's choice between
 * `record` and `recordIn` is about *when* the row commits, never about what it
 * says, so a test asserting what was recorded must not have to know which one
 * the implementation reached for — and a test that DID distinguish them would
 * fail the day an operation correctly moved inside a transaction.
 *
 * It ignores the manager. This helper cannot roll back, so an entry written
 * through `recordIn` inside a transaction that later throws is still in the
 * array. Where that distinction is the property under test — "a refusal records
 * nothing" — the assertion has to be made against `FakeDataSource`'s own rows,
 * which do roll back, rather than against this.
 */
export function recordingAudit(into: RecordAuditEntryInput[]): AuditService {
  return {
    record: async (input: RecordAuditEntryInput) => {
      into.push(input);
    },
    recordIn: async (_manager: unknown, input: RecordAuditEntryInput) => {
      into.push(input);
    },
  } as unknown as AuditService;
}
