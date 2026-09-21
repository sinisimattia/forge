import type { ResourceGrant, ResourceGrantJSON } from '__FORGE_SCOPE__/core/authorization/types';

/**
 * A grant, as every caller of this backend is shown it. Core's own wire
 * shape, aliased rather than restated — see `MemberResponseDto` for why an
 * alias is used wherever one is available.
 */
export type GrantResponseDto = ResourceGrantJSON;

/**
 * One hydrated grant to its wire shape.
 *
 * Unlike `Membership` or `Organization`, `ResourceGrant` is a plain
 * interface with no `toJSON` of its own — `to-grant.ts`'s own TSDoc explains
 * why: layer three's rules live in `can` and `isGrantLive`, not on the grant
 * itself, so there is no domain entity here to carry a serializer. This
 * function is that serializer's one and only home, mirroring exactly what
 * `toPrincipalResponse` does for each grant nested in a principal.
 *
 * @param grant - as `AuthorizationService` produced it
 * @returns the same grant, with both instants as ISO-8601 strings
 */
export function toGrantResponse(grant: ResourceGrant): GrantResponseDto {
  return {
    id: grant.id,
    subjectUserId: grant.subjectUserId,
    organizationId: grant.organizationId,
    resourceType: grant.resourceType,
    resourceId: grant.resourceId,
    permission: grant.permission,
    grantedBy: grant.grantedBy,
    createdAt: grant.createdAt.toISOString(),
    expiresAt: grant.expiresAt === null ? null : grant.expiresAt.toISOString(),
  };
}
