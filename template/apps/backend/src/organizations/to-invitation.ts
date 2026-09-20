import { Invitation } from '__FORGE_SCOPE__/core/organizations/entities';
import type { InvitationId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { InvitationRecord } from './invitation-record.entity';

/**
 * One row to one entity, in one place. See `to-user.ts` for why this is a
 * free function rather than a static on whichever service needed it first.
 *
 * It builds a real `Invitation`, so every invariant the entity enforces runs
 * on every read — a row whose address is not one fails here rather than being
 * handed on as something that looks like an invitation and is not.
 *
 * `row.tokenHash` is not read here. `Invitation` has no field for it — see
 * `InvitationRecord`'s own TSDoc — so there is nothing for this mapper to
 * assign it to, which is the point: the boundary that would leak a hash into
 * a served invitation does not exist.
 *
 * **`invitedByUserId` is cast rather than guarded.** `InvitationRecord`
 * declares it nullable (`ON DELETE SET NULL`, so an invitation outlives the
 * account that sent it), while core's `Invitation.invitedByUserId` is a
 * non-nullable `UserId` — that mismatch predates this file and is not
 * resolved here; it is noted in Task 9's report for review. In the case this
 * mapper is asked to read a row whose inviter has since been deleted, the
 * cast produces an `Invitation` claiming a `UserId` of `null`, which nothing
 * downstream currently guards against.
 *
 * @param row - the stored row
 * @returns the same invitation as a domain entity
 */
export function toInvitationEntity(row: InvitationRecord): Invitation {
  return new Invitation({
    id: row.id as InvitationId,
    organizationId: row.organizationId as OrganizationId,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedByUserId: row.invitedByUserId as UserId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId as UserId | null,
  });
}
