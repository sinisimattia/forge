import { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import type { IAuditService } from '__FORGE_SCOPE__/core/audit/contracts';
import type {
  AuditEntryId,
  AuditEntryJSON,
  AuditQuery,
  RecordAuditEntryInput,
} from '__FORGE_SCOPE__/core/audit/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

/**
 * A reference implementation over a Map of wire rows.
 *
 * It stores rows rather than entities on purpose: that is the shape a real
 * implementation has to map back into an entity on every read, so the suite is
 * driven through the same rehydration a real one performs — and it is what makes
 * the wire-shape assertion able to fail, since a row seeded in a form the entity
 * would rewrite stays in that form until something rebuilds the entity from it.
 *
 * Writing it is also the cheapest possible proof that the contract is
 * implementable at all, which is the reason it exists rather than a stub that
 * resolves everything.
 *
 * It has no `update`, no `delete` and no `purge`, and the conformance suite's
 * shape guarantee asserts as much by reading this object's own members.
 */
export class InMemoryAuditService implements IAuditService {
  private readonly entries = new Map<string, AuditEntryJSON>();
  private written = 0;

  /** Puts an entry row into the world exactly as given, without rebuilding it. */
  seedEntry(row: AuditEntryJSON): void {
    this.entries.set(row.id, row);
  }

  async record(input: RecordAuditEntryInput): Promise<void> {
    this.written += 1;
    const id = `audit-written-${this.written}` as AuditEntryId;
    // Mapped field by field rather than spread, because that is where a real
    // implementation's mapping lives and therefore where its bugs live too.
    this.entries.set(id, {
      id,
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: { ...input.metadata },
      clientAddress: input.clientAddress,
      clientLabel: input.clientLabel,
      occurredAt: input.occurredAt.toISOString(),
    });
  }

  // `_actorId` because this reference implementation reads across the whole
  // deployment for anybody: what entitlement means, and what refusal looks like
  // for an actor who has none, belongs to authorization (ADR-0006) and not to this
  // contract, and the conformance suite deliberately pins no answer to it.
  async query(_actorId: UserId, query: AuditQuery): Promise<PaginatedResult<AuditEntry>> {
    const matches = [...this.entries.values()]
      .filter((row) => InMemoryAuditService.matches(row, query))
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));

    const from = (query.page - 1) * query.limit;
    return {
      data: matches.slice(from, from + query.limit).map((row) => AuditEntry.fromJSON(row)),
      meta: {
        total: matches.length,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(matches.length / query.limit),
      },
    };
  }

  /** Every filter the query names has to hold; an omitted filter narrows nothing. */
  private static matches(row: AuditEntryJSON, query: AuditQuery): boolean {
    if (query.action !== undefined && row.action !== query.action) return false;
    if (query.actorId !== undefined && String(row.actorId) !== String(query.actorId)) return false;
    // An explicit null narrows to the entries that belong to no tenant; an
    // omitted filter (checked by `!== undefined`, not truthiness) narrows
    // nothing at all — the same distinction `actorId` and `action` draw above.
    if (query.organizationId !== undefined && row.organizationId !== query.organizationId) {
      return false;
    }
    // Inclusive, so a bound taken from an entry's own instant includes that entry.
    if (query.asOf !== undefined && Date.parse(row.occurredAt) > query.asOf.getTime()) return false;
    return true;
  }
}
