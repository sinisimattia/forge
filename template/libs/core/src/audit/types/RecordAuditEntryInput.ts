import type { AuditEntryProps } from './AuditEntryProps';

/**
 * Everything a caller supplies to record one entry.
 *
 * Narrowed from the entity's own props rather than declared again, so the two
 * can never drift: the only field a caller does not supply is the identifier,
 * which the implementation's store assigns.
 *
 * `occurredAt` is supplied rather than read from a clock at write time. An entry
 * may be written later than the moment it describes — a queued write, a batch, a
 * retry — and the instant worth recording is the one the action happened at, not
 * the one the row was inserted at. It being a value the caller passes is also
 * what makes "the instant was recorded faithfully" something a test can pin.
 */
export type RecordAuditEntryInput = Omit<AuditEntryProps, 'id'>;
