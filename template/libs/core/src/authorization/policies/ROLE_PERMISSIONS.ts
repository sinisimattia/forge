import { OrgRole } from '../../organizations/enums/OrgRole';
import type { Permission } from '../types/Permission';

/**
 * What each organization role may do, as data.
 *
 * A map and not a comparison against role order, because a comparison silently
 * re-ranks every role the day a member is inserted in the middle of the enum.
 * `Record<OrgRole, …>` makes a missing role a compile error; the suite beside
 * this file catches the other half — a role given an empty array to make that
 * error go away, and a less powerful role holding something a more powerful one
 * lacks. That suite reads the enum's declaration order once, deliberately, as
 * the statement that the map agrees with the names it uses. Nothing in `can`
 * reads it.
 *
 * `platform:administer` appears in no entry. It is layer one's alone, which is
 * why every pass through layer one is audit-logged: it is the one kind of access
 * whose justification is not visible in the request.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  [OrgRole.OWNER]: [
    'organization:read', 'organization:update', 'organization:delete',
    'member:read', 'member:invite', 'member:update', 'member:remove',
    'invitation:read', 'invitation:revoke',
    'grant:read', 'grant:create', 'grant:revoke',
    'audit:read',
  ],
  [OrgRole.ADMIN]: [
    'organization:read', 'organization:update',
    'member:read', 'member:invite', 'member:update', 'member:remove',
    'invitation:read', 'invitation:revoke',
    'grant:read', 'grant:create', 'grant:revoke',
    'audit:read',
  ],
  [OrgRole.MEMBER]: ['organization:read', 'member:read'],
  [OrgRole.VIEWER]: ['organization:read'],
};
