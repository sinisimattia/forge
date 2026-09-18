import type { UserId } from '../../users/types/UserId';
import type { AuditAction } from '../enums/AuditAction';
import type { AuditEntryId } from '../types/AuditEntryId';
import type { AuditEntryJSON } from '../types/AuditEntryJSON';
import type { AuditEntryProps } from '../types/AuditEntryProps';

/**
 * One thing that happened, recorded so it can be reconstructed later.
 *
 * The entity has no invariant that can refuse a value, and the absence is
 * deliberate rather than an oversight. Recording is not allowed to fail for a
 * business reason — see {@link IAuditService.record} — and an entity that threw
 * would hand every caller a reason to record less. The one thing the
 * constructor does do is take the history out of its author's hands: `metadata`
 * is copied and frozen, so an entry cannot be altered through the object a
 * caller happens to still be holding.
 *
 * That freeze is shallow, and saying so is the point: an object nested inside
 * `metadata` stays mutable to whoever passed it. Walking arbitrary caller data
 * to freeze it deeply would buy very little, because the guarantee that
 * actually holds is not in this constructor at all — it is a privilege on the
 * table that refuses the application the statements that would change a row.
 */
export class AuditEntry {
  /** The entry's identifier. */
  readonly id: AuditEntryId;
  /**
   * The tenant it happened in, or `null` when it belonged to none.
   *
   * A plain string until Phase 3, which makes it a branded `OrganizationId`.
   * See {@link AuditEntryProps.organizationId} for why it is here before there
   * is anything to put in it.
   */
  readonly organizationId: string | null;
  /** Who did it, or `null` when nobody was identified. */
  readonly actorId: UserId | null;
  /** What happened. */
  readonly action: AuditAction;
  /** What kind of thing it happened to, or `null` when it was not about a thing. */
  readonly resourceType: string | null;
  /** Which thing of that kind, or `null` when it was not about a thing. */
  readonly resourceId: string | null;
  /** Whatever else is worth reconstructing later. Never anything secret. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** The network address the action came from, as the implementation saw it. */
  readonly clientAddress: string | null;
  /** A short, opaque description of the client, or `null` if none was offered. */
  readonly clientLabel: string | null;
  /** When it happened. */
  readonly occurredAt: Date;

  /** @param props - the ten facts that make up an entry */
  constructor(props: AuditEntryProps) {
    this.id = props.id;
    this.organizationId = props.organizationId;
    this.actorId = props.actorId;
    this.action = props.action;
    this.resourceType = props.resourceType;
    this.resourceId = props.resourceId;
    this.metadata = Object.freeze({ ...props.metadata });
    this.clientAddress = props.clientAddress;
    this.clientLabel = props.clientLabel;
    this.occurredAt = props.occurredAt;
  }

  /** The wire shape: the instant as an ISO-8601 string. */
  toJSON(): AuditEntryJSON {
    return {
      id: this.id,
      organizationId: this.organizationId,
      actorId: this.actorId,
      action: this.action,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      metadata: this.metadata,
      clientAddress: this.clientAddress,
      clientLabel: this.clientLabel,
      occurredAt: this.occurredAt.toISOString(),
    };
  }

  /**
   * Rebuilds an entry from its wire shape, reviving the instant.
   *
   * @param json - an entry as it crosses a serialization boundary
   * @returns the same entry as a real entity, its instant a `Date` again
   */
  static fromJSON(json: AuditEntryJSON): AuditEntry {
    return new AuditEntry({
      id: json.id,
      organizationId: json.organizationId,
      actorId: json.actorId,
      action: json.action,
      resourceType: json.resourceType,
      resourceId: json.resourceId,
      metadata: json.metadata,
      clientAddress: json.clientAddress,
      clientLabel: json.clientLabel,
      occurredAt: new Date(json.occurredAt),
    });
  }
}
