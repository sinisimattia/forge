import type { ClientContext } from '__FORGE_SCOPE__/core/auth/types';
import type { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { AuditService } from '../audit/audit.service';

/**
 * One audit write for an event about a user account, with the fixed
 * `organizationId` of `null` and `resourceType` of `'user'`.
 *
 * `AuthService` and `OAuthService` each carried a private copy of this, which is a second
 * place the fixed shape is spelled — the shape that drifts.
 */
export function recordUserAudit(
  audit: AuditService,
  action: AuditAction,
  actorId: UserId | null,
  metadata: Record<string, unknown>,
  occurredAt: Date,
  client: ClientContext = { address: null, label: null },
): Promise<void> {
  return audit.record({
    organizationId: null,
    actorId,
    action,
    resourceType: 'user',
    resourceId: actorId,
    metadata,
    clientAddress: client.address,
    clientLabel: client.label,
    occurredAt,
  });
}
