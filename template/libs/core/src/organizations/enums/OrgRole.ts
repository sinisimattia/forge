/**
 * What somebody may do inside one organization.
 *
 * A role is a property of a *membership*, never of a user: the same person can
 * be an OWNER of one organization and a VIEWER of another, so no value here can
 * live on `User` — there is no single answer to put there. `User.platformRole`
 * is a different axis entirely: it is the first of the three layers `can`
 * evaluates, about operating the deployment rather than about any one
 * organization (ADR-0006), and it is never implied by any role here.
 *
 * Ordered most to least powerful in the declaration, but **nothing reads that
 * order**. Permissions come from `ROLE_PERMISSIONS`, an explicit map, because a
 * comparison against declaration order silently re-ranks every role the day a
 * member is inserted in the middle.
 */
export enum OrgRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}
