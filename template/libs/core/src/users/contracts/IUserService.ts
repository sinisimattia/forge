import type { PaginatedResult } from '../../shared/types/PaginatedResult';
import type { User } from '../entities/User';
import type { PlatformRole } from '../enums/PlatformRole';
import type { UserStatus } from '../enums/UserStatus';
import type { UpdateUserProfileInput } from '../types/UpdateUserProfileInput';
import type { UserId } from '../types/UserId';
import type { UserQuery } from '../types/UserQuery';

/**
 * Reading and administering people.
 *
 * Every method takes `actorId` — the user on whose behalf the call is made —
 * as its first parameter. Nothing is resolved from ambient state: an
 * implementation that decided for itself who was calling would be impossible
 * to reason about and impossible to test, and the same reasoning that keeps
 * tenancy explicit keeps the actor explicit (ADR-0007).
 *
 * Creating an account is not here: an account comes into being by registering
 * (`IAuthService.register`), which is the only path that also establishes how
 * the person will prove who they are.
 */
export interface IUserService {
  /**
   * The profile of `targetId`.
   *
   * A user may read their own profile; a platform administrator may read any.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param targetId - the user whose profile is wanted
   * @returns the target's profile
   * @throws UserNotFoundError when no such user exists, and when the actor is
   * not entitled to it — the two are indistinguishable on purpose, so that
   * probing for ids reveals nothing.
   */
  getProfile(actorId: UserId, targetId: UserId): Promise<User>;

  /**
   * Updates the actor's own profile. There is no path to another user's.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param input - the fields to change; an omitted field is left alone
   * @returns the updated user
   * @throws DisplayNameRequiredError when the new display name is blank
   */
  updateProfile(actorId: UserId, input: UpdateUserProfileInput): Promise<User>;

  /**
   * Soft-deletes the actor's own account and ends every session it holds.
   * The record remains so that history referencing it stays readable.
   *
   * @param actorId - the user on whose behalf the call is made
   */
  deleteAccount(actorId: UserId): Promise<void>;

  /**
   * Lists accounts. Platform administrators only.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param query - which page is wanted, and an optional filter
   * @returns one page of accounts, with the totals a caller needs
   */
  listUsers(actorId: UserId, query: UserQuery): Promise<PaginatedResult<User>>;

  /**
   * Suspends or reinstates an account. Platform administrators only.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param targetId - the account to suspend or reinstate
   * @param status - the standing the account is to have
   * @returns the updated user
   * @throws UserNotFoundError when no such user exists
   */
  setStatus(actorId: UserId, targetId: UserId, status: UserStatus): Promise<User>;

  /**
   * Grants or withdraws platform administration. Platform administrators only.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param targetId - the account whose standing changes
   * @param role - the standing the account is to have
   * @returns the updated user
   * @throws UserNotFoundError when no such user exists
   */
  setPlatformRole(actorId: UserId, targetId: UserId, role: PlatformRole): Promise<User>;
}
