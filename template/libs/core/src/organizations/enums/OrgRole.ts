/**
 * What somebody may do inside one organization.
 *
 * A role is a property of a *membership*, never of a user: the same person can
 * be an OWNER of one organization and a VIEWER of another, which is exactly why
 * spec §9.4 keeps roles off `User`. `User.platformRole` is a different axis
 * entirely — it is about operating the deployment — and is never implied by any
 * role here.
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
