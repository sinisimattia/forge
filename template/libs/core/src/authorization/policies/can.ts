import { assertNever } from '../../shared/policies/assertNever';
import { PlatformRole } from '../../users/enums/PlatformRole';
import type { Permission } from '../types/Permission';
import type { Principal, Resource } from '../types/Principal';
import { ROLE_PERMISSIONS } from './ROLE_PERMISSIONS';

/**
 * The one access decision in this project (ADR-0006).
 *
 * It is its own domain rather than a member of `shared/`, and that placement is
 * deliberate. It needs `PlatformRole` and `UserId`, so putting it under
 * `shared/` made `shared/` — the folder every other domain depends on — depend
 * on a domain in turn. No cycle resulted, because every edge in both directions
 * is a deep path rather than a barrel, but nothing enforced that and an
 * inversion in a folder named `shared` is the kind of thing the next person
 * copies. It is also the module a second consumer imports by name: a client
 * calls this same function to decide what to render, so the subpath it imports
 * is worth being `authorization` rather than `shared/policies`.
 *
 * Pure: no lookup, no state, no clock, no persistence. Given the same principal
 * and the same resource it returns the same answer, which is what makes it
 * callable from both sides of the wire — the server to **decide** whether a
 * request proceeds, a client to **predict** what the server would say so it can
 * hide an action rather than offer one that will be refused.
 *
 * **A client-side `true` is never a permission.** Both sides call this function
 * and only one of them is authoritative; the server re-derives the answer from
 * its own principal on every request, whatever any client concluded. Nothing in
 * the type system distinguishes the two uses, which ADR-0006 records as the
 * price of having one statement of the rules instead of two that drift.
 *
 * ## What it evaluates, and what it does not yet
 *
 * ADR-0006 describes three layers in order: platform role, organization role,
 * resource grant. **The first two exist here, and the ownership half of the
 * third**; the grant half arrives with grants themselves. That is still written
 * as a short function rather than as a scaffold with an empty layer in it: an
 * empty layer is a branch no test can fail and a shape the next phase is obliged
 * to keep whether or not it fits.
 *
 * `PLATFORM_ADMIN` passing everything is the first layer, and it is the reason
 * every such pass is recorded: it is a pass the ordinary rules would have
 * refused, so it is the one kind of access whose justification is not visible in
 * the request itself.
 *
 * @param principal - who is asking, hydrated by the caller
 * @param permission - what they are asking to do
 * @param resource - the record it concerns, for the permissions that have one
 * @returns whether the rules permit it
 */
export function can(
  principal: Principal,
  permission: Permission,
  resource?: Resource,
): boolean {
  // Layer one. Deliberately ahead of the switch and not a case in it: it is not
  // a rule about any one permission, it is the statement that this principal
  // operates the deployment and so passes every rule the deployment has —
  // including the ones added after this line was written.
  if (principal.platformRole === PlatformRole.PLATFORM_ADMIN) return true;

  // Layer two — organization role (ADR-0006, spec §9.5).
  //
  // The membership consulted is the one for the RESOURCE's organization. Reading
  // "the principal's role" without saying which organization it is in would give
  // a person their strongest role everywhere they belong, which is a cross-tenant
  // escalation wearing the shape of a convenience.
  //
  // A resource with no `organizationId` skips this layer rather than failing it:
  // `user:read` is about a person, not a tenant, and the switch below is where it
  // is answered.
  if (resource?.organizationId !== undefined) {
    const membership = principal.memberships.find(
      (m) => m.organizationId === resource.organizationId,
    );
    // No membership means no organization-role answer at all — not a weaker one.
    // This is the core half of tenant isolation.
    if (membership === undefined) return false;
    if (ROLE_PERMISSIONS[membership.role].includes(permission)) return true;
  }

  switch (permission) {
    case 'platform:administer':
      // Nothing below layer one grants it, and no organization role appears
      // above with it either — `ROLE_PERMISSIONS` is asserted against that.
      return false;
    case 'audit:read':
    case 'organization:read':
    case 'organization:update':
    case 'organization:delete':
    case 'member:read':
    case 'member:invite':
    case 'member:update':
    case 'member:remove':
    case 'invitation:read':
    case 'invitation:revoke':
    case 'grant:read':
    case 'grant:create':
    case 'grant:revoke':
      // Every member here is answered by layer two when it can be answered at
      // all, so reaching this line means one of exactly two things: the ask named
      // no organization, or it named one whose role does not carry the
      // permission. Both are refusals. An ask with no organization is refused
      // rather than read as "any organization I belong to", which is the same
      // judgement `user:read` makes for a missing owner — and for `audit:read`
      // it is the difference between one organization's entries and the
      // deployment's whole history, which only layer one answers.
      return false;
    case 'user:read':
      // A profile is readable by the person it is about. `resource === undefined`
      // is a caller that asked whether somebody may read "a profile" without
      // saying whose, which is not a question with an answer — so it is refused
      // rather than treated as "their own". A resource that names an owner of
      // `undefined` is refused by the same comparison.
      return resource !== undefined && resource.ownerId === principal.userId;
    default:
      // Reachable only from outside the type system. The compiler rejects a new
      // member of `Permission` that no case above handles, which is the point:
      // a permission added without a rule must not silently inherit `false`.
      return assertNever(permission);
  }
}
