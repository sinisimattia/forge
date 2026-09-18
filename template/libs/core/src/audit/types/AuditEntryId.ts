import type { Brand } from '../../shared/types/Brand';

/** An audit entry's identifier. Branded so it cannot be passed where another id is expected. */
export type AuditEntryId = Brand<string, 'AuditEntryId'>;
