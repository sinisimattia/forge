import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type {
  CreateGrantInput,
  GrantId,
  GrantQuery,
  ResourceGrantJSON,
} from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { ApiClient } from '~/types';

/**
 * The `/organizations/:id/grants` endpoints, one function apiece.
 *
 * Each issues a request and returns the parsed body. No mapping and no error
 * handling: both belong to `AuthorizationHttpService`, which is the only
 * thing that knows a `409` here means `CrossTenantGrantError` and a `404`
 * means `GrantNotFoundError`.
 */

/** One page of an organization's grants. */
export async function getGrants(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  query: GrantQuery,
): Promise<PaginatedResult<ResourceGrantJSON>> {
  return client<PaginatedResult<ResourceGrantJSON>>({
    method: 'GET',
    path: `/organizations/${String(organizationId)}/grants`,
    actor,
    query: { page: query.page, limit: query.limit },
  });
}

/** Issues one exception: this subject, this record, this permission. */
export async function postGrant(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  input: CreateGrantInput,
): Promise<ResourceGrantJSON> {
  return client<ResourceGrantJSON>({
    method: 'POST',
    path: `/organizations/${String(organizationId)}/grants`,
    body: {
      subjectUserId: input.subjectUserId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      permission: input.permission,
      // Field by field, as every other fetcher here is: `expiresAt` crossing
      // as `undefined` and `expiresAt` crossing as `null` are two different
      // asks — see `CreateGrantInput.expiresAt` — and the omission has to be
      // deliberate rather than a spread away from being lost.
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    },
    actor,
  });
}

/** Withdraws a grant. */
export async function deleteGrant(
  client: ApiClient,
  actor: UserId,
  organizationId: OrganizationId,
  grantId: GrantId,
): Promise<void> {
  await client<undefined>({
    method: 'DELETE',
    path: `/organizations/${String(organizationId)}/grants/${String(grantId)}`,
    actor,
  });
}
