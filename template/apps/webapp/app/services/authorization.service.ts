import type { IAuthorizationService } from '__FORGE_SCOPE__/core/authorization/contracts';
import { CrossTenantGrantError, GrantNotFoundError } from '__FORGE_SCOPE__/core/authorization/errors';
import type {
  CreateGrantInput,
  GrantId,
  GrantQuery,
  ResourceGrant,
  ResourceGrantJSON,
} from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { ApiError, deleteGrant, getGrants, postGrant } from '~/fetchers';
import type { ApiClient } from '~/types';

/**
 * The wire shape to the domain shape, field by field — never a cast.
 *
 * `ResourceGrant` is a plain interface, not an entity with a `fromJSON` of
 * its own: `to-grant.ts`'s own TSDoc on the backend explains why — layer
 * three's rules live in `can` and `isGrantLive`, not on the grant itself, so
 * there is no invariant here to re-run. That does not make a cast honest in
 * its place. `createdAt` and `expiresAt` arrive as ISO-8601 strings and the
 * contract promises `Date` — `created.createdAt instanceof Date` is one of
 * the seven assertions this function exists to keep true, and
 * `json as unknown as ResourceGrant` would satisfy the type and fail exactly
 * that check, the same way a missing `fromJSON` call would on the other two
 * entities. This is that reviver's one and only home on this side of the
 * wire, mirroring what `toGrantResponse` does in the other direction on the
 * backend.
 *
 * @param json - a grant as it crosses the wire
 * @returns the same grant, its instants revived
 */
function toResourceGrant(json: ResourceGrantJSON): ResourceGrant {
  return {
    id: json.id,
    subjectUserId: json.subjectUserId,
    organizationId: json.organizationId,
    resourceType: json.resourceType,
    resourceId: json.resourceId,
    permission: json.permission,
    grantedBy: json.grantedBy,
    createdAt: new Date(json.createdAt),
    expiresAt: json.expiresAt === null ? null : new Date(json.expiresAt),
  };
}

/** What a call site knows about its own subject, for the error's own message. */
interface ErrorContext {
  organizationId?: string;
  subjectUserId?: string;
  grantId?: string;
}

/**
 * The error the contract names for a refusal that arrived as an envelope.
 *
 * Unlike `OrganizationHttpService`'s own `domainErrorFor`, there is no `404`
 * fallback here: `IAuthorizationService` names no error for "you may not
 * administer this organization's grants" — that is `PermissionsGuard`'s own
 * question, decided before `AuthorizationService` is ever reached (see that
 * backend service's own TSDoc on `listGrants`), and this contract does not
 * restate it. A `404` with no code this service does not recognise is
 * therefore returned untouched, exactly as `UserHttpService`'s own
 * `domainErrorFor` returns anything it does not name.
 *
 * @param error - whatever the fetcher threw
 * @param context - what this call site knows about its own subject
 * @returns the error to throw
 */
function domainErrorFor(error: unknown, context: ErrorContext = {}): unknown {
  if (!(error instanceof ApiError)) return error;
  switch (error.body.code) {
    case 'GRANT_NOT_FOUND':
      return new GrantNotFoundError(context.grantId ?? '');
    case 'CROSS_TENANT_GRANT':
      return new CrossTenantGrantError(context.organizationId ?? '', context.subjectUserId ?? '');
    default:
      return error;
  }
}

/**
 * Implements the core contract over the wire.
 *
 * Two responsibilities, and no others: turn a response into the value the
 * contract promises, and turn a failure into the error the contract names.
 * `ResourceGrant` carries no entity to satisfy an `instanceof` check with, so
 * the conformance suite's equivalent guard is `created.createdAt instanceof
 * Date` — see `toResourceGrant`'s own TSDoc for what would go red without it.
 */
export class AuthorizationHttpService implements IAuthorizationService {
  private readonly client: ApiClient;

  /** @param client - the transport the fetchers issue through */
  public constructor(client: ApiClient) {
    this.client = client;
  }

  /** @inheritdoc */
  public async listGrants(
    actorId: UserId,
    organizationId: OrganizationId,
    query: GrantQuery,
  ): Promise<PaginatedResult<ResourceGrant>> {
    try {
      const page = await getGrants(this.client, actorId, organizationId, query);
      return { data: page.data.map((json) => toResourceGrant(json)), meta: page.meta };
    } catch (error) {
      throw domainErrorFor(error, { organizationId: String(organizationId) });
    }
  }

  /** @inheritdoc */
  public async createGrant(
    actorId: UserId,
    organizationId: OrganizationId,
    input: CreateGrantInput,
  ): Promise<ResourceGrant> {
    try {
      return toResourceGrant(await postGrant(this.client, actorId, organizationId, input));
    } catch (error) {
      throw domainErrorFor(error, {
        organizationId: String(organizationId),
        subjectUserId: String(input.subjectUserId),
      });
    }
  }

  /** @inheritdoc */
  public async revokeGrant(
    actorId: UserId,
    organizationId: OrganizationId,
    grantId: GrantId,
  ): Promise<void> {
    try {
      await deleteGrant(this.client, actorId, organizationId, grantId);
    } catch (error) {
      throw domainErrorFor(error, {
        organizationId: String(organizationId),
        grantId: String(grantId),
      });
    }
  }
}
