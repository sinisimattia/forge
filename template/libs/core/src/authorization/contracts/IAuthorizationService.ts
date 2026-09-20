import type { OrganizationId } from '../../organizations/types/OrganizationId';
import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import type { UserId } from '../../users/types/UserId';
import type { CreateGrantInput } from '../types/CreateGrantInput';
import type { GrantId } from '../types/GrantId';
import type { GrantQuery } from '../types/GrantQuery';
import type { ResourceGrant } from '../types/ResourceGrant';

/**
 * The record-level exceptions layer three reads: issuing them, listing them,
 * withdrawing them.
 *
 * It administers grants and decides nothing. `can` is the decision — one
 * decision, ADR-0006 — and this is the store the third layer of it is hydrated
 * from. An implementation that answered "may this person do that" here would be
 * a second statement of the rules, which is the thing ADR-0006 exists to
 * prevent.
 *
 * Every method takes `actorId` — the user on whose behalf the call is made —
 * and the `organizationId` it acts inside, explicitly. Nothing is resolved from
 * ambient state (ADR-0007). The organization is a parameter rather than a field
 * of the input for a reason particular to this contract: it is the boundary
 * every method is confined to, and a boundary a caller passes inside a payload
 * is one a payload can move.
 *
 * Two rules run through the whole of it, and both are asserted by
 * `runIAuthorizationServiceContract`:
 *
 * - **A grant never crosses a tenant.** It can only be issued to somebody who
 *   is already a member of the organization it names — see
 *   {@link CrossTenantGrantError} — and it is only ever listed or withdrawn
 *   through the organization it belongs to.
 * - **Nothing distinguishes "does not exist" from "not in this organization."**
 *   A grant belonging to another organization answers {@link GrantNotFoundError},
 *   the same answer as an id nobody ever issued, so that trying ids in turn
 *   reveals nothing about another tenant's exceptions.
 */
export interface IAuthorizationService {
  /**
   * The grants issued inside one organization.
   *
   * Scoped to that organization and to nothing wider: a grant of another
   * organization is not in the page, whatever the actor's standing elsewhere.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization whose grants are wanted
   * @param query - which page is wanted
   * @returns one page of grants, with the totals a caller needs
   */
  listGrants(
    actorId: UserId,
    organizationId: OrganizationId,
    query: GrantQuery,
  ): Promise<PaginatedResult<ResourceGrant>>;

  /**
   * Issues one exception: this subject, this record, this permission.
   *
   * The actor becomes the grant's `grantedBy`, taken from the parameter and
   * never from the input, so that an exception always has somebody accountable
   * for it and the input cannot name a different somebody.
   *
   * @param actorId - the user on whose behalf the call is made, recorded as the issuer
   * @param organizationId - the organization the grant is confined to
   * @param input - who it is for, which record, which permission, and when it lapses
   * @returns the new grant
   * @throws CrossTenantGrantError when the subject is not a member of the organization
   */
  createGrant(
    actorId: UserId,
    organizationId: OrganizationId,
    input: CreateGrantInput,
  ): Promise<ResourceGrant>;

  /**
   * Withdraws a grant. It stops existing rather than being marked ended: a
   * withdrawn exception has no history worth keeping that the audit log does not
   * already hold, and a soft-deleted one is a row layer three would have to
   * remember to skip.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param organizationId - the organization the grant belongs to
   * @param grantId - the grant to withdraw
   * @throws GrantNotFoundError when no such grant exists, and when it belongs to
   * another organization — the two are indistinguishable on purpose.
   */
  revokeGrant(
    actorId: UserId,
    organizationId: OrganizationId,
    grantId: GrantId,
  ): Promise<void>;
}
