import { PlatformRole } from '../../users/enums/PlatformRole';
import type { OwnedResource } from '../types/Principal';
import type { Permission } from '../types/Permission';
import type { Principal } from '../types/Principal';
import { assertNever } from './assertNever';

/**
 * The one access decision in this project (ADR-0006).
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
 * resource grant. **Only the first and the ownership half of the third exist
 * here**, because organizations do not exist yet. That is written as a short
 * function rather than as a scaffold with two empty layers in it: an empty
 * layer is a branch no test can fail and a shape the next phase is obliged to
 * keep whether or not it fits.
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
  resource?: OwnedResource,
): boolean {
  // Layer one. Deliberately ahead of the switch and not a case in it: it is not
  // a rule about any one permission, it is the statement that this principal
  // operates the deployment and so passes every rule the deployment has —
  // including the ones added after this line was written.
  if (principal.platformRole === PlatformRole.PLATFORM_ADMIN) return true;

  switch (permission) {
    case 'platform:administer':
    case 'audit:read':
      // Nothing below platform administration grants either, today. When
      // organizations arrive, `audit:read` gains an organization-scoped answer
      // here and `platform:administer` does not — see `Permission`.
      return false;
    case 'user:read':
      // A profile is readable by the person it is about. `resource === undefined`
      // is a caller that asked whether somebody may read "a profile" without
      // saying whose, which is not a question with an answer — so it is refused
      // rather than treated as "their own".
      return resource !== undefined && resource.ownerId === principal.userId;
    default:
      // Reachable only from outside the type system. The compiler rejects a new
      // member of `Permission` that no case above handles, which is the point:
      // a permission added without a rule must not silently inherit `false`.
      return assertNever(permission);
  }
}
