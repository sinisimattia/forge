import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON, UserQuery } from '__FORGE_SCOPE__/core/users/types';
import type { ApiClient } from '~/types';

/**
 * The `/users` endpoints, one function apiece.
 *
 * Each issues a request and returns the parsed body. No mapping and no error
 * handling: both belong to `UserHttpService`, which is the only thing that knows
 * a `404` here means `UserNotFoundError`.
 *
 * `withCookie` is absent throughout, and that is deliberate rather than an
 * omission: the renewal cookie belongs to the `/auth` paths that set and spend
 * it, and sending it on every ordinary read would widen its exposure for no
 * benefit.
 */

/** The actor's own profile. */
export async function getMe(client: ApiClient, actor: UserId): Promise<UserJSON> {
  return client<UserJSON>({ method: 'GET', path: '/users/me', actor });
}

/** One account by id. Platform administrators only. */
export async function getUser(
  client: ApiClient,
  actor: UserId,
  targetId: UserId,
): Promise<UserJSON> {
  return client<UserJSON>({ method: 'GET', path: `/users/${String(targetId)}`, actor });
}

/** Changes the actor's own profile. */
export async function patchMe(
  client: ApiClient,
  actor: UserId,
  changes: { displayName?: string },
): Promise<UserJSON> {
  return client<UserJSON>({ method: 'PATCH', path: '/users/me', body: changes, actor });
}

/** Closes the actor's own account. */
export async function deleteMe(client: ApiClient, actor: UserId): Promise<void> {
  await client<undefined>({ method: 'DELETE', path: '/users/me', actor });
}

/** One page of accounts. Platform administrators only. */
export async function getUsers(
  client: ApiClient,
  actor: UserId,
  query: UserQuery,
): Promise<PaginatedResult<UserJSON>> {
  return client<PaginatedResult<UserJSON>>({
    method: 'GET',
    path: '/users',
    actor,
    query: {
      page: query.page,
      limit: query.limit,
      ...(query.search === undefined ? {} : { search: query.search }),
    },
  });
}

/** Suspends or reinstates an account. Platform administrators only. */
export async function patchUserStatus(
  client: ApiClient,
  actor: UserId,
  targetId: UserId,
  status: UserStatus,
): Promise<UserJSON> {
  return client<UserJSON>({
    method: 'PATCH',
    path: `/users/${String(targetId)}/status`,
    body: { status },
    actor,
  });
}

/** Grants or withdraws platform administration. Platform administrators only. */
export async function patchUserPlatformRole(
  client: ApiClient,
  actor: UserId,
  targetId: UserId,
  platformRole: PlatformRole,
): Promise<UserJSON> {
  return client<UserJSON>({
    method: 'PATCH',
    path: `/users/${String(targetId)}/platform-role`,
    body: { platformRole },
    actor,
  });
}
