import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { UserId } from '../../users/types/UserId';
import type { AuditAction } from '../enums/AuditAction';
import type { AuditEntryId } from '../types/AuditEntryId';
import type { AuditEntryJSON } from '../types/AuditEntryJSON';
import type { AuditEntryProps } from '../types/AuditEntryProps';

/**
 * One thing that happened, recorded so it can be reconstructed later.
 *
 * The entity refuses nothing **at construction**, and the qualifier carries
 * weight. Recording is not allowed to fail for a business reason — see
 * {@link IAuditService.record} — and an entity that threw would hand every
 * caller a reason to record less, so there is no value a caller can offer that
 * this constructor rejects. The one thing it does do is take the history out of
 * its author's hands: `metadata` is copied and frozen, so an entry cannot be
 * altered through the object a caller happens to still be holding.
 *
 * One thing can still fail, later than anybody would want it to. A row whose
 * `occurredAt` cannot be parsed builds an entry silently and then throws from
 * {@link AuditEntry.toJSON} when somebody reads it — refusing at read time,
 * which for an append-only table is the worse of the two places, because the
 * row that provoked it is one nothing may correct. Nothing in this application
 * can produce such a row: the only writer is `record`, and it is handed a
 * `Date`. If this entity ever gains a second way in — rows from somewhere
 * other than this application's own writes — {@link AuditEntry.fromJSON} is
 * where that has to be caught, being the one boundary where refusing costs a
 * reader nothing and a writer nothing.
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
   * See {@link AuditEntryProps.organizationId} for why it is here before there
   * is anything to put in it.
   */
  readonly organizationId: OrganizationId | null;
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
