import type { PaginatedResult } from '__FORGE_SCOPE__/core/shared/types';
import type { IUserService } from '__FORGE_SCOPE__/core/users/contracts';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { UserNotFoundError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserServiceContractContext } from '__FORGE_SCOPE__/core/users/testing';
import { makeUserJSON, runIUserServiceContract } from '__FORGE_SCOPE__/core/users/testing';
import type {
  UpdateUserProfileInput,
  UserId,
  UserJSON,
  UserQuery,
} from '__FORGE_SCOPE__/core/users/types';
import { jestConformanceExpect } from '../../shared/testing/jestConformanceExpect';

/**
 * A reference implementation over a Map of wire rows.
 *
 * It stores rows rather than entities on purpose: that is the shape a real
 * implementation has to map back into an entity on every read, so the suite is
 * driven through the same rehydration a real one performs.
 */
class InMemoryUserService implements IUserService {
  private readonly rows = new Map<string, UserJSON>();

  constructor(seed: readonly UserJSON[]) {
    for (const row of seed) this.rows.set(row.id, row);
  }

  private row(id: UserId): UserJSON {
    const found = this.rows.get(id);
    if (found === undefined) throw new UserNotFoundError(id);
    return found;
  }

  /** Rebuilds the entity from a row — which re-runs every invariant — then stores it back. */
  private save(row: UserJSON): User {
    const user = User.fromJSON(row);
    this.rows.set(user.id, user.toJSON());
    return user;
  }

  async getProfile(_actorId: UserId, targetId: UserId): Promise<User> {
    return User.fromJSON(this.row(targetId));
  }

  async updateProfile(actorId: UserId, input: UpdateUserProfileInput): Promise<User> {
    const row = this.row(actorId);
    const displayName = input.displayName === undefined ? row.displayName : input.displayName;
    return this.save({ ...row, displayName, updatedAt: new Date().toISOString() });
  }

  async deleteAccount(actorId: UserId): Promise<void> {
    const row = this.row(actorId);
    this.save({ ...row, deletedAt: new Date().toISOString() });
  }

  async listUsers(_actorId: UserId, query: UserQuery): Promise<PaginatedResult<User>> {
    const all = [...this.rows.values()];
    const search = query.search;
    const matching = search === undefined
      ? all
      : all.filter((row) => row.displayName.includes(search) || row.email.includes(search));
    const start = (query.page - 1) * query.limit;
    return {
      data: matching.slice(start, start + query.limit).map((row) => User.fromJSON(row)),
      meta: {
        total: matching.length,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(matching.length / query.limit),
      },
    };
  }

  async setStatus(_actorId: UserId, targetId: UserId, status: UserStatus): Promise<User> {
    const row = this.row(targetId);
    return this.save({ ...row, status, updatedAt: new Date().toISOString() });
  }

  async setPlatformRole(
    _actorId: UserId,
    targetId: UserId,
    platformRole: PlatformRole,
  ): Promise<User> {
    const row = this.row(targetId);
    return this.save({ ...row, platformRole, updatedAt: new Date().toISOString() });
  }
}

// Deliberately not in normal form: the suite requires it, because it is what
// makes normalization something an implementation can be caught failing to do.
// An implementation that hands back the row its store holds, rather than
// rebuilding the entity from it, returns an email that differs visibly from the
// promised one.
const ACTOR_EMAIL_AS_GIVEN = '  Ada@Example.COM ';

/** A fresh world holding exactly the three users the suite is promised. */
async function makeContext(): Promise<UserServiceContractContext> {
  const actorRow = makeUserJSON({ email: ACTOR_EMAIL_AS_GIVEN });
  const otherRow = makeUserJSON({
    id: 'user-2' as UserId,
    email: 'grace@example.com',
    displayName: 'Grace',
  });
  const adminRow = makeUserJSON({
    id: 'user-3' as UserId,
    email: 'admin@example.com',
    displayName: 'Root',
    platformRole: PlatformRole.PLATFORM_ADMIN,
  });

  return {
    service: new InMemoryUserService([actorRow, otherRow, adminRow]),
    actor: User.fromJSON(actorRow),
    actorEmailAsGiven: ACTOR_EMAIL_AS_GIVEN,
    other: User.fromJSON(otherRow),
    admin: User.fromJSON(adminRow),
  };
}

runIUserServiceContract({
  describe,
  it,
  expect: jestConformanceExpect,
  makeContext,
  // Well-formed for this store — its keys are plain strings — and in no world.
  absentId: 'no-such-user' as UserId,
});
