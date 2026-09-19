import type { IIdentityService } from '__FORGE_SCOPE__/core/identities/contracts';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import {
  IdentityNotFoundError,
  LastIdentityRemovalError,
} from '__FORGE_SCOPE__/core/identities/errors';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { ApiError, deleteIdentity, getIdentities } from '~/fetchers';
import type { ApiClient } from '~/types';

/**
 * The error the contract names for a refusal that arrived as an envelope.
 *
 * `404` and `409` both reach this service, and neither status is enough on its
 * own: `404` is also what a missing user answers, and `409` is also what a
 * duplicate address answers. The backend's `code` is what tells them apart, and
 * it is read first. The `404` fallback below exists for the same refusal
 * `UserHttpService` documents — a guard's indistinguishable-by-design answer,
 * which carries no domain code.
 *
 * @param error - whatever the fetcher threw
 * @param subject - the id the caller asked about, for the error's own message
 * @returns the error to throw
 */
function domainErrorFor(error: unknown, subject: string): unknown {
  if (!(error instanceof ApiError)) return error;
  switch (error.body.code) {
    case 'IDENTITY_NOT_FOUND':
      return new IdentityNotFoundError(subject);
    case 'LAST_IDENTITY_REMOVAL':
      return new LastIdentityRemovalError();
    default:
      // A `404` with no code the webapp recognises is still an identity nobody
      // may see, for the reason `UserHttpService` gives at length. Anything else
      // is returned untouched.
      return error.status === 404 ? new IdentityNotFoundError(subject) : error;
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
 * **The unlink rule is not re-implemented here, and must not be.** Whether the
 * identity is the actor's and whether it is their last are decided once, by
 * core's `assertAtLeastOneIdentityRemains`, on the side that can see every
 * identity the account holds. A count check in this service would be a second
 * copy of a rule — one that can disagree with the first, and that would disagree
 * for any user whose identity list this webapp had not just refreshed.
 */
export class IdentityHttpService implements IIdentityService {
  private readonly client: ApiClient;

  /** @param client - the transport the fetchers issue through */
  public constructor(client: ApiClient) {
    this.client = client;
  }

  /** @inheritdoc */
  public async listIdentities(actorId: UserId): Promise<AuthIdentity[]> {
    try {
      const listed = await getIdentities(this.client, actorId);
      return listed.map((json) => AuthIdentity.fromJSON(json));
    } catch (error) {
      throw domainErrorFor(error, String(actorId));
    }
  }

  /** @inheritdoc */
  public async unlinkIdentity(actorId: UserId, identityId: AuthIdentityId): Promise<void> {
    try {
      await deleteIdentity(this.client, actorId, identityId);
    } catch (error) {
      throw domainErrorFor(error, String(identityId));
    }
  }
}
