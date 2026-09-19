import type { AuthIdentityId, AuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { ApiClient } from '~/types';

/**
 * The `/users/me/identities` endpoints, one function apiece.
 *
 * The path is `/users/me/...` because that is what these are: part of the
 * actor's own account, with no route anywhere that takes somebody else's id.
 * There is nothing to spell here for another user, which is the point.
 */

/** Every identity the actor holds. */
export async function getIdentities(
  client: ApiClient,
  actor: UserId,
): Promise<AuthIdentityJSON[]> {
  return client<AuthIdentityJSON[]>({ method: 'GET', path: '/users/me/identities', actor });
}

/** Gives one of them up. */
export async function deleteIdentity(
  client: ApiClient,
  actor: UserId,
  identityId: AuthIdentityId,
): Promise<void> {
  await client<undefined>({
    method: 'DELETE',
    path: `/users/me/identities/${String(identityId)}`,
    actor,
  });
}
