import type { IUserService } from '__FORGE_SCOPE__/core/users/contracts';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import type { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { DisplayNameRequiredError, UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import type {
  UpdateUserProfileInput,
  UserId,
  UserQuery,
} from '__FORGE_SCOPE__/core/users/types';
import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import {
  ApiError,
  deleteMe,
  getMe,
  getUser,
  getUsers,
  patchMe,
  patchUserPlatformRole,
  patchUserStatus,
} from '~/fetchers';
import type { ApiClient } from '~/types';

/**
 * The error the contract names for a refusal that arrived as an envelope.
 *
 * It reads the backend's `code` **first**, and the reason is that a status alone
 * is ambiguous: `404` is reached by three different core errors — a missing
 * user, a missing identity, a missing session — and `422` by a blank display
 * name and by a refused password.
 *
 * It falls back to the status for `404` alone, and that one is not laziness.
 * `PlatformAdminGuard` refuses with a `404` carrying no domain code, in the same
 * status and the same body as `UserNotFoundError`, precisely so that "you may
 * not" and "there is no such thing" cannot be told apart — and a caller that
 * surfaced one as a domain error and the other as a transport failure would undo
 * that at the top of the screen.
 *
 * Everything else is returned untouched: an `ApiError` reaching a caller says
 * "the server refused and this layer does not know what that means", which is
 * honest, where a `UserNotFoundError` invented for a `502` would not be.
 *
 * @param error - whatever the fetcher threw
 * @param subject - the id the caller asked about, for the error's own message
 * @returns the error to throw
 */
function domainErrorFor(error: unknown, subject: string): unknown {
  if (!(error instanceof ApiError)) return error;
  switch (error.body.code) {
    case 'USER_NOT_FOUND':
      return new UserNotFoundError(subject);
    case 'DISPLAY_NAME_REQUIRED':
      return new DisplayNameRequiredError();
    default:
      // A `404` with no code the webapp recognises is still a user nobody may
      // see. `PlatformAdminGuard` answers exactly that — same status, same body
      // as `UserNotFoundError` — precisely so that "you may not" and "there is
      // no such thing" cannot be told apart, and this side must not undo it by
      // reporting one of them as a transport failure and the other as a domain
      // one. Anything else is returned untouched.
      return error.status === 404 ? new UserNotFoundError(subject) : error;
  }
}

/**
 * Implements the core contract over the wire.
 *
 * Two responsibilities, and no others: turn a response into the entity the
 * contract promises, and turn a failure into the error the contract names. A
 * caller of this service cannot tell it from the other implementation, which is
 * what the shared conformance suite exists to keep true.
 *
 * **`User.fromJSON` on every path, never a cast.** The reviver re-runs the
 * entity's invariants — it normalizes the address and trims the display name —
 * so a payload the domain would not accept fails here rather than travelling
 * onward as an object that merely has the right keys. A service that handed back
 * `json as unknown as User` would satisfy every type in this file and fail the
 * conformance suite's `instanceof` checks, which is precisely why those checks
 * are in it.
 *
 * `actorId` is used for routing and never for authorization: `getProfile`
 * asks `/users/me` when the actor is asking about itself and `/users/:id`
 * otherwise, and the server decides in both cases from the credential it was
 * presented. The contract takes the actor explicitly (ADR-0007) and the
 * transport carries a credential; this is where the two meet.
 */
export class UserHttpService implements IUserService {
  private readonly client: ApiClient;

  /** @param client - the transport the fetchers issue through */
  public constructor(client: ApiClient) {
    this.client = client;
  }

  /** @inheritdoc */
  public async getProfile(actorId: UserId, targetId: UserId): Promise<User> {
    try {
      const json = actorId === targetId
        ? await getMe(this.client, actorId)
        : await getUser(this.client, actorId, targetId);
      return User.fromJSON(json);
    } catch (error) {
      throw domainErrorFor(error, String(targetId));
    }
  }

  /** @inheritdoc */
  public async updateProfile(actorId: UserId, input: UpdateUserProfileInput): Promise<User> {
    try {
      // Field by field rather than passing `input`: the wire's shape and core's
      // are separate things, and the day they differ the compiler must say so
      // here rather than a field crossing that nothing on either side declared.
      return User.fromJSON(await patchMe(this.client, actorId, {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      }));
    } catch (error) {
      throw domainErrorFor(error, String(actorId));
    }
  }

  /** @inheritdoc */
  public async deleteAccount(actorId: UserId): Promise<void> {
    try {
      await deleteMe(this.client, actorId);
    } catch (error) {
      throw domainErrorFor(error, String(actorId));
    }
  }

  /** @inheritdoc */
  public async listUsers(actorId: UserId, query: UserQuery): Promise<PaginatedResult<User>> {
    try {
      const page = await getUsers(this.client, actorId, query);
      // `meta` crosses unchanged because it is numbers about the query, not
      // about any entity; `data` does not, because every element of it has to
      // become a real `User`.
      return { data: page.data.map((json) => User.fromJSON(json)), meta: page.meta };
    } catch (error) {
      throw domainErrorFor(error, String(actorId));
    }
  }

  /** @inheritdoc */
  public async setStatus(
    actorId: UserId,
    targetId: UserId,
    status: UserStatus,
  ): Promise<User> {
    try {
      return User.fromJSON(await patchUserStatus(this.client, actorId, targetId, status));
    } catch (error) {
      throw domainErrorFor(error, String(targetId));
    }
  }

  /** @inheritdoc */
  public async setPlatformRole(
    actorId: UserId,
    targetId: UserId,
    role: PlatformRole,
  ): Promise<User> {
    try {
      return User.fromJSON(await patchUserPlatformRole(this.client, actorId, targetId, role));
    } catch (error) {
      throw domainErrorFor(error, String(targetId));
    }
  }
}
