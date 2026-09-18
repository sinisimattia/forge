import type { UserId } from '../../users/types/UserId';
import { AuditAction } from '../enums/AuditAction';
import type { AuditEntryId } from '../types/AuditEntryId';
import type { AuditEntryJSON } from '../types/AuditEntryJSON';

/**
 * Build a valid {@link AuditEntryJSON} wire object, overriding any fields.
 *
 * The default is the commonest entry there is: a successful sign-in, belonging
 * to no tenant, naming an actor and no resource, with nothing known about the
 * client and nothing extra to say — because that is the state most tests need
 * before they change exactly one thing about it.
 *
 * @param overrides - fields to replace on the default
 * @returns a complete wire object
 */
export function makeAuditEntryJSON(overrides: Partial<AuditEntryJSON> = {}): AuditEntryJSON {
  return {
    id: 'audit-1' as AuditEntryId,
    organizationId: null,
    actorId: 'user-1' as UserId,
    action: AuditAction.LOGIN_SUCCEEDED,
    resourceType: null,
    resourceId: null,
    metadata: {},
    clientAddress: null,
    clientLabel: null,
    occurredAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
