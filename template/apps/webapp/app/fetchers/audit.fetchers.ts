import type { AuditEntryJSON } from '__FORGE_SCOPE__/core/audit/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { ApiClient } from '~/types';

/**
 * One page of one organization's own audit history.
 *
 * There is exactly one fetcher here, not one per `IAuditService` method:
 * `record` has no business being callable from a browser at all — recording
 * is the backend's own act, on the backend's own clock, over a request it
 * has already authenticated — and the platform-wide `GET /audit` has no
 * caller in this application, which builds no platform-administration
 * screen. See `~/services/organizationAudit.service.ts` for why that
 * service does not claim to implement the full contract.
 */
export async function getOrganizationAudit(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  query: { page: number; limit: number },
): Promise<PaginatedResult<AuditEntryJSON>> {
  return client<PaginatedResult<AuditEntryJSON>>({
    method: 'GET',
    path: `/organizations/${String(organizationId)}/audit`,
    actor,
    query: { page: query.page, limit: query.limit },
  });
}
