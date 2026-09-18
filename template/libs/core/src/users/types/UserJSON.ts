import type { PlatformRole } from '../enums/PlatformRole';
import type { UserStatus } from '../enums/UserStatus';
import type { UserId } from './UserId';

/**
 * The wire shape of a {@link User}: the same nine facts, with every instant as
 * an ISO-8601 string, because a serialized payload has no `Date`.
 *
 * There is no field here for secret material, and there never will be — the
 * entity has none to serialize, so no payload built from one can carry it.
 */
export interface UserJSON {
  /** The user's identifier. */
  id: UserId;
  /** The address in normal form. */
  email: string;
  /** The name shown to other people. */
  displayName: string;
  /** Whether the account may be used at all. */
  status: UserStatus;
  /** The person's standing with respect to the deployment. */
  platformRole: PlatformRole;
  /** When the address was proven, or `null` if it has not been. */
  emailVerifiedAt: string | null;
  /** When the account came into being. */
  createdAt: string;
  /** When the account was last changed. */
  updatedAt: string;
  /** When the account was soft-deleted, or `null` if it has not been. */
  deletedAt: string | null;
}
