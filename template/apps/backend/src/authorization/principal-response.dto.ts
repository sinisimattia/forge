import type {
  Principal,
  PrincipalMembership,
  ResourceGrantJSON,
} from '__FORGE_SCOPE__/core/authorization/types';
import type { PlatformRole } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

/**
 * The actor's own principal, as `GET /users/me/principal` answers it.
 *
 * It exists because `can` is meant to be evaluated on both sides of the wire
 * (ADR-0006) — a client hides an action rather than offering one the server will
 * refuse — and a client cannot evaluate it without the principal. Nothing else
 * in this backend produces one: the access credential deliberately carries two
 * claims (design ruling R4), so there is no other source a webapp could read.
 *
 * **It is about the actor themselves**, so it carries no `@RequirePermission`:
 * there is no organization to judge it against, and the one thing it discloses
 * is what the caller already is. It is not `@Public()` either — a principal with
 * no proven subject is not a question with an answer.
 *
 * ## Why it is the same key set as `Principal`, enforced by the compiler
 *
 * The client parses this into the exact structure it passes to `can`, so a key
 * this side invents is a key that side drops, and a key this side omits is a
 * layer of the decision the client silently evaluates as empty — which reads as
 * a refusal, not as an error. The assertion at the foot of this file is what
 * turns either into a build failure, following `UserResponseDto`'s reasoning: a
 * mismatch that is merely assignable is invisible to every test.
 *
 * **No secret material can reach it structurally**, not by redaction: the three
 * facts it carries are the three `Principal` has, none of which is a
 * credential, and the shape assertion is what stops a fourth being added here.
 */
export interface PrincipalResponseDto {
  /** Whose principal this is. */
  userId: UserId;
  /** Their standing with respect to the deployment. */
  platformRole: PlatformRole;
  /** Every organization they belong to, and their role in each. */
  memberships: readonly PrincipalMembership[];
  /**
   * The record-level exceptions they hold, **live as of the instant this was
   * served** — the hydrator applied `isGrantLive` and a lapsed grant is absent
   * rather than present and ignored (design ruling R2). Instants are ISO-8601
   * strings, because a serialized payload has no `Date`.
   */
  grants: readonly ResourceGrantJSON[];
}

/**
 * The key sets, compared by the compiler rather than by this file's prose.
 *
 * Both directions: an extra key is a field the client drops, a missing key is a
 * layer of `can` the client evaluates as empty. Written as a key comparison and
 * not a mutual-assignability check for `UserResponseDto`'s stated reason — an
 * optional extra field is assignable both ways and populates nothing at runtime,
 * so no test in this backend can see it.
 */
type ExtraKeys = Exclude<keyof PrincipalResponseDto, keyof Principal>;
type MissingKeys = Exclude<keyof Principal, keyof PrincipalResponseDto>;
type SameKeys = [ExtraKeys | MissingKeys] extends [never] ? true : never;
export const WIRE_SHAPE_IS_EXACTLY_THE_PRINCIPAL: SameKeys = true;

/**
 * One hydrated principal to its wire shape.
 *
 * The only transformation is the two instants on each grant; everything else
 * crosses unchanged, which is the property the assertion above protects.
 *
 * @param principal - as `PrincipalService.hydrate` produced it
 * @returns the same three facts, serializable
 */
export function toPrincipalResponse(principal: Principal): PrincipalResponseDto {
  return {
    userId: principal.userId,
    platformRole: principal.platformRole,
    memberships: principal.memberships,
    grants: principal.grants.map((grant) => ({
      id: grant.id,
      subjectUserId: grant.subjectUserId,
      organizationId: grant.organizationId,
      resourceType: grant.resourceType,
      resourceId: grant.resourceId,
      permission: grant.permission,
      grantedBy: grant.grantedBy,
      createdAt: grant.createdAt.toISOString(),
      expiresAt: grant.expiresAt === null ? null : grant.expiresAt.toISOString(),
    })),
  };
}
