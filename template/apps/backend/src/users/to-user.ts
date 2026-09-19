import { User } from '__FORGE_SCOPE__/core/users/entities';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { UserRecord } from './user-record.entity';

/**
 * One row to one entity, in one place.
 *
 * A free function rather than a static on whichever service happened to need it
 * first, because three services need it and a mapper copied into each of them is
 * three chances for the copies to disagree about what a row means — which is the
 * failure mode this backend already avoids for the identity mapper
 * (`IdentitiesService.toStoredSecret`) and for the same reason.
 *
 * The branded id is asserted here, in one visible line. `UserRecord.id` is a
 * plain `string` deliberately (see that class), so this is the boundary where a
 * stored value is claimed to belong to the users domain, and it is the only one.
 *
 * Note what it does **not** do: it builds a real `User`, so every invariant the
 * entity enforces runs on every read. A row whose display name is blank, or
 * whose address is not one, fails here rather than being handed on as something
 * that looks like a user and is not.
 *
 * @param row - the stored row
 * @returns the same account as a domain entity
 */
export function toUserEntity(row: UserRecord): User {
  return new User({
    id: row.id as UserId,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    platformRole: row.platformRole,
    emailVerifiedAt: row.emailVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}
