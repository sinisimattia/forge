import type { PlatformRole } from '../enums/PlatformRole';
import type { UserStatus } from '../enums/UserStatus';
import type { UserId } from './UserId';

/**
 * Everything needed to construct a {@link User}.
 *
 * A named object rather than positional parameters: with nine fields, three of
 * them nullable and two of them adjacent instants, a positional constructor
 * makes a silent transposition possible that no compiler can catch.
 */
export interface UserProps {
  /** The user's identifier. */
  id: UserId;
  /** The address as given; the entity stores its normal form. */
  email: string;
  /** The name shown to other people; the entity stores it trimmed. */
  displayName: string;
  /** Whether the account may be used at all. */
  status: UserStatus;
  /** The person's standing with respect to the deployment. */
  platformRole: PlatformRole;
  /** When the address was proven, or `null` if it has not been. */
  emailVerifiedAt: Date | null;
  /** When the account came into being. */
  createdAt: Date;
  /** When the account was last changed. */
  updatedAt: Date;
  /** When the account was soft-deleted, or `null` if it has not been. */
  deletedAt: Date | null;
}
