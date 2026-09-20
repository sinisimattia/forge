import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { UserId } from '../../users/types/UserId';
import type { AuditAction } from '../enums/AuditAction';
import type { AuditEntryId } from './AuditEntryId';

/**
 * Everything needed to construct an {@link AuditEntry}.
 *
 * A named object rather than positional parameters, and here the reason is
 * blunter than in the other domains: six of the ten fields are nullable and
 * five of those are strings, so a positional constructor would let two of them
 * swap places with no compiler anywhere to notice — in the one table nothing is
 * permitted to correct afterwards.
 */
export interface AuditEntryProps {
  /** The entry's identifier. */
  id: AuditEntryId;
  /**
   * The tenant the recorded action happened in, or `null` when it belonged to
   * no tenant.
   *
   * A branded `OrganizationId` now that Phase 3 has organizations to brand it
   * against. The field was here before there was anything to put in it because
   * this table is append-only: adding a column later means backfilling rows the
   * application is not permitted to update. `null` is a fact — "this belonged to
   * no tenant" — not a value that has gone missing (ADR-0007).
   */
  organizationId: OrganizationId | null;
  /**
   * Who did it, or `null` when nobody was identified.
   *
   * Nullable because the actions most worth recording include the ones nobody
   * was signed in for: a failed sign-in has no actor by definition, and it is
   * the entry a reader wants most.
   */
  actorId: UserId | null;
  /** What happened. */
  action: AuditAction;
  /** What kind of thing it happened to, or `null` when it was not about a thing. */
  resourceType: string | null;
  /** Which thing of that kind, or `null` when it was not about a thing. */
  resourceId: string | null;
  /**
   * Whatever else is worth reconstructing later — the shape of which is the
   * caller's business, not this domain's.
   *
   * **Nothing secret, ever.** No secret, no derivation of one, no single-use
   * credential, not even a truncated one. This is the most-read table in an
   * incident and the least-protected in a backup: whatever goes in here is read
   * by people who were never granted the thing it describes, and it is read
   * years later, from a copy nobody is tracking. A value that must not be seen
   * has no form in which it is safe to put here.
   */
  metadata: Readonly<Record<string, unknown>>;
  /** The network address the action came from, as the implementation saw it. */
  clientAddress: string | null;
  /** A short, opaque description of the client, or `null` if none was offered. */
  clientLabel: string | null;
  /** When it happened. */
  occurredAt: Date;
}
