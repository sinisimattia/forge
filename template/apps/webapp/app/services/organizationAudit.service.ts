import { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import type { AuditEntryJSON } from '__FORGE_SCOPE__/core/audit/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { getOrganizationAudit } from '~/fetchers';
import type { ApiClient } from '~/types';

/**
 * Reads one organization's own audit history over the wire.
 *
 * **Not an `IAuditService` implementation, and not exported from
 * `~/services`'s barrel — on purpose.** That barrel's own TSDoc says every
 * member in it is an `I*Service` "in full", held to core's shared
 * conformance suite (DEC-1), and this class cannot honestly make that claim
 * twice over:
 *
 * - `record` is not implemented, because it must never be callable from a
 *   browser. Recording is the backend's own act — it runs on the server's
 *   clock, over a request the server has already authenticated as one
 *   actor, and it is deliberately impossible to fail for a business reason
 *   (`IAuditService.record`'s own TSDoc). A client that could call it would
 *   let a browser write history it did not itself observe.
 * - `query`'s full contract answers a platform administrator's read of the
 *   *whole deployment* as well as an organization's own read of itself, and
 *   only the second exists as a screen in this application — there is no
 *   platform-administration surface here to call the first. Implementing it
 *   anyway to satisfy a type this class does not need would be
 *   `assertNever`'s opposite: a promise this package has no way to keep.
 *
 * So this is a narrower, honestly-named thing beside the sibling services
 * rather than a partial version of one of them: it turns what
 * `GET /organizations/:id/audit` answers into `AuditEntry`, and nothing
 * else. `AuditEntry.fromJSON` on every row, never a cast, for the same
 * reason `OrganizationHttpService`'s own reviver calls are — a payload that
 * merely has the right keys is not an entity.
 */
export class OrganizationAuditHttpService {
  private readonly client: ApiClient;

  /** @param client - the transport the fetchers issue through */
  public constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * One page of one organization's own history, newest first.
   *
   * @param actorId - who is asking
   * @param organizationId - the tenant whose history is wanted
   * @param query - which page is wanted
   * @returns the page, its entries revived
   */
  public async queryForOrganization(
    actorId: UserId,
    organizationId: OrganizationId,
    query: { page: number; limit: number },
  ): Promise<PaginatedResult<AuditEntry>> {
    const page = await getOrganizationAudit(this.client, actorId, organizationId, query);
    return {
      data: page.data.map((json: AuditEntryJSON) => AuditEntry.fromJSON(json)),
      meta: page.meta,
    };
  }
}
