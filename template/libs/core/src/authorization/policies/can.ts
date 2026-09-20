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
 * ## What it evaluates
 *
 * ADR-0006's three layers, in order: platform role, organization role, resource
 * grant. All three are here now, and the order is not cosmetic — each later
 * layer can only add to what an earlier one allowed. Layer one is unconditional,
 * layer two is the only layer that can refuse outright, and layer three is
 * additive alone.
 *
 * `PLATFORM_ADMIN` passing everything is the first layer, and it is the reason
 * every such pass is recorded: it is a pass the ordinary rules would have
 * refused, so it is the one kind of access whose justification is not visible in
 * the request itself.
 *
 * **Nothing here reads a clock**, including layer three, which does not consult
 * a grant's `expiresAt`. `Principal.grants` holds the grants that were live when
 * the principal was hydrated, `isGrantLive` is the rule, and the hydrator is what
 * applies it. That is what keeps this function's promise that the same inputs
 * give the same answer.
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

  // Layer three — resource grant (ADR-0006, spec §9.5). The exceptions a role
  // cannot express: this one person, this one record, this one permission.
  //
  // Additive only: it can turn a `false` into a `true` and never the reverse,
  // which is why it runs after the role check rather than instead of it. A
  // principal whose role already allowed the ask has returned above.
  //
  // It is reached only by a principal who holds a membership for this
  // organization, because layer two refuses outright when there is none. That
  // ordering is what makes spec §9.5's sentence true — grants never widen into
  // another tenant "because `can()` requires the resource's `organizationId` to
  // match the principal's membership". Fold that refusal into the `if` above and
  // a grant would authorize somebody who belongs to the organization not at all.
  //
  // **`expiresAt` is not read here, and that is deliberate.** Reading it needs a
  // clock, and a clock would make this function impure — the same principal and
  // resource would stop producing the same answer, which is exactly what lets
  // the server and a client both call it. `Principal.grants` is documented as
  // live as of hydration and `isGrantLive` is the rule the hydrator applies.
  //
  // All three of organization, type and id must be named. Two of them name no
  // record: a type with no id is every record of that kind, and an id with no
  // type is an id in a namespace nobody stated.
  //
  // `platform:administer` is excluded by name, which is the one thing this layer
  // is not additive about. Layer one is its only route — `ROLE_PERMISSIONS` is
  // asserted to carry it nowhere — and a grant is issued by an organization's own
  // administrator under `grant:create`, an organization-scoped permission. Without
  // this clause somebody whose authority ends at a tenant could issue the one
  // permission that has no tenant. A grant is an exception *inside* a tenant,
  // never a way out of one.
  if (
    permission !== 'platform:administer'
    && resource?.organizationId !== undefined
    && resource.resourceType !== undefined
    && resource.resourceId !== undefined
  ) {
    const granted = principal.grants.some(
      (grant) => grant.permission === permission
        // All four together, and the organization is the one that stops a grant
        // widening: matching on the record id alone would let a grant in one
        // tenant answer for a record that happens to share an id in another.
        && grant.organizationId === resource.organizationId
        && grant.resourceType === resource.resourceType
        && grant.resourceId === resource.resourceId,
    );
    if (granted) return true;
  }

  switch (permission) {
    case 'platform:administer':
      // Nothing below layer one grants it: no organization role appears above
      // with it — `ROLE_PERMISSIONS` is asserted against that — and layer three
      // excludes it by name. This line is the only answer the other two layers
      // can leave it.
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
      // Every member here is answered above when it can be answered at all, so
      // reaching this line means one of exactly three things: the ask named no
      // organization; it named one whose role does not carry the permission and
      // no record either; or it named a record no grant of the principal's
      // matches. All three are refusals. An ask with no organization is refused
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
