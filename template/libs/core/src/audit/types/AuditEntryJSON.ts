import type { UserId } from '../../users/types/UserId';
import type { AuditAction } from '../enums/AuditAction';
import type { AuditEntryId } from './AuditEntryId';

/**
 * The wire shape of an {@link AuditEntry}: the same ten facts, with the instant
 * as an ISO-8601 string, because a serialized payload has no `Date`.
 *
 * `metadata` crosses as whatever the caller put in it, which is why the rule
 * about what may go in it is a rule about the *caller* — see
 * {@link AuditEntryProps.metadata}. Nothing downstream of this type can filter
 * a secret back out of a value that was already written.
 */
export interface AuditEntryJSON {
  /** The entry's identifier. */
  id: AuditEntryId;
  /** The tenant it happened in, or `null` when it belonged to none. */
  organizationId: string | null;
  /** Who did it, or `null` when nobody was identified. */
  actorId: UserId | null;
  /** What happened. */
  action: AuditAction;
  /** What kind of thing it happened to, or `null` when it was not about a thing. */
  resourceType: string | null;
  /** Which thing of that kind, or `null` when it was not about a thing. */
  resourceId: string | null;
  /** Whatever else is worth reconstructing later. Never anything secret. */
  metadata: Readonly<Record<string, unknown>>;
  /** The network address the action came from, or `null` if none was seen. */
  clientAddress: string | null;
  /** A short, opaque description of the client, or `null` if none was offered. */
  clientLabel: string | null;
  /** When it happened, ISO-8601. */
  occurredAt: string;
}
