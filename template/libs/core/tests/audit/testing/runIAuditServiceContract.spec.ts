import { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { AuditServiceContractContext } from '__FORGE_SCOPE__/core/audit/testing';
import { makeAuditEntryJSON, runIAuditServiceContract } from '__FORGE_SCOPE__/core/audit/testing';
import type { AuditEntryId } from '__FORGE_SCOPE__/core/audit/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';
import { InMemoryAuditService } from './InMemoryAuditService';

const READER = 'user-ada' as UserId;
const FILTER_ACTOR = 'user-hopper' as UserId;
const OTHER_ACTOR = 'user-grace' as UserId;

// Carried by exactly one seeded entry, and by an entry FILTER_ACTOR did not do —
// the pair is what lets the suite tell narrowing by both filters from narrowing
// by either.
const FILTER_ACTION = AuditAction.PROFILE_UPDATED;
// Carried by no seeded entry, so a query narrowed to it finds exactly what the
// suite itself recorded.
const FRESH_ACTION = AuditAction.PLATFORM_ADMIN_OVERRIDE;

// Deliberately not the spelling the entity emits. The entity revives it into a
// `Date` and renders it back canonically, so an implementation that passed the
// store's own string through instead of rebuilding the entity from the row
// returns an instant that differs visibly from the promised one.
const NEWEST_AS_STORED = '2026-02-03T04:05:06+00:00';

/**
 * A fresh world: three entries already recorded, newest first.
 *
 * The newest carries a value in every field there is, because it is the one the
 * wire-shape test compares field by field and a null on either side would make
 * that comparison agree for the wrong reason.
 */
async function makeContext(): Promise<AuditServiceContractContext> {
  const service = new InMemoryAuditService();

  const newest = makeAuditEntryJSON({
    id: 'audit-newest' as AuditEntryId,
    actorId: READER,
    action: AuditAction.LOGIN_SUCCEEDED,
    resourceType: 'Article',
    resourceId: 'article-3',
    metadata: { title: 'On the margins', previousTitle: null },
    clientAddress: '203.0.113.9',
    clientLabel: 'a seeded client',
    occurredAt: NEWEST_AS_STORED,
  });
  const middle = makeAuditEntryJSON({
    id: 'audit-middle' as AuditEntryId,
    actorId: FILTER_ACTOR,
    action: AuditAction.LOGGED_OUT,
    occurredAt: '2026-02-02T00:00:00.000Z',
  });
  const oldest = makeAuditEntryJSON({
    id: 'audit-oldest' as AuditEntryId,
    actorId: OTHER_ACTOR,
    action: FILTER_ACTION,
    resourceType: 'Article',
    resourceId: 'article-9',
    occurredAt: '2026-02-01T00:00:00.000Z',
  });

  // Seeded shuffled, which the deps interface asks for and cannot check: with
  // the store already holding them newest-first, an implementation that sorts
  // nothing at all would pass the ordering assertion.
  service.seedEntry(middle);
  service.seedEntry(oldest);
  service.seedEntry(newest);

  return {
    service,
    readerId: READER,
    // Built through the reviver, which is what the entities the service returns
    // are built through too — so the comparison is between two entities, not
    // between an entity and the row one of them came from.
    seeded: [newest, middle, oldest].map((row) => AuditEntry.fromJSON(row)),
    filterAction: FILTER_ACTION,
    filterActorId: FILTER_ACTOR,
    freshAction: FRESH_ACTION,
  };
}

runIAuditServiceContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
});
