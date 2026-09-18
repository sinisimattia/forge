import { User } from '../entities/User';
import { PlatformRole } from '../enums/PlatformRole';
import { UserStatus } from '../enums/UserStatus';
import { DisplayNameRequiredError } from '../errors/DisplayNameRequiredError';
import { UserNotFoundError } from '../errors/UserNotFoundError';
import type { IUserServiceContractDeps } from './IUserServiceContractDeps';

/**
 * The behavior every {@link IUserService} implementation must exhibit.
 *
 * Each implementation drives this suite with its own runner's
 * `describe`/`it`/`expect`, which is what makes "they behave the same" a fact
 * the build checks rather than a claim a reviewer makes. The suite asserts
 * behavior only: who is *allowed* to do these things is enforced where the
 * implementation lives, and is held to its own suite there.
 *
 * Every assertion here has to be one an implementation can actually fail. An
 * entity invariant re-checked on a value the entity itself built is a tautology,
 * however much it looks like a guard — so each method compares what the service
 * returned against the world the host promised, and proves that what came back
 * is a real entity rather than the raw shape some store or peer handed over.
 *
 * @param deps - the host runner's primitives, a fresh-world factory, and an id
 * well-formed for the host's store that no world contains
 */
export function runIUserServiceContract(deps: IUserServiceContractDeps): void {
  const { describe, it, expect, makeContext, absentId } = deps;

  describe('IUserService conformance', () => {
    describe('getProfile', () => {
      it('returns the actor\'s own profile, as a real entity', async () => {
        const { service, actor } = await makeContext();
        const profile = await service.getProfile(actor.id, actor.id);
        expect.ok(profile instanceof User, 'getProfile must return a real entity');
        expect.equal(profile.id, actor.id);
        expect.equal(profile.displayName, actor.displayName);
      });

      // The world was built from an address that is not in normal form, and
      // `actor` carries the normal form; comparing the two is what an
      // implementation returning the address it was given fails.
      it('returns the address in normal form, not the form the world was given', async () => {
        const { service, actor } = await makeContext();
        const profile = await service.getProfile(actor.id, actor.id);
        expect.equal(profile.email, actor.email);
      });

      it('rejects an id that does not exist', async () => {
        const { service, actor } = await makeContext();
        await expect.rejects(
          () => service.getProfile(actor.id, absentId),
          UserNotFoundError,
        );
      });
    });

    describe('updateProfile', () => {
      it('changes the display name and returns the updated user', async () => {
        const { service, actor } = await makeContext();
        const updated = await service.updateProfile(actor.id, { displayName: 'Ada Lovelace' });
        expect.ok(updated instanceof User, 'updateProfile must return a real entity');
        expect.equal(updated.displayName, 'Ada Lovelace');

        const reread = await service.getProfile(actor.id, actor.id);
        expect.equal(reread.displayName, 'Ada Lovelace');
      });

      // Trimming is an invariant of the entity, so an implementation that
      // returns a real `User` gets it for free and cannot fail this. What it
      // still catches is an implementation that hands back whatever its store
      // or its peer gave it without rebuilding the entity from it — the same
      // failure the `instanceof` check in the test above catches, from the
      // other side. Kept for that reason and for no other.
      it('trims the new display name', async () => {
        const { service, actor } = await makeContext();
        const updated = await service.updateProfile(actor.id, { displayName: '  Ada Lovelace  ' });
        expect.equal(updated.displayName, 'Ada Lovelace');
      });

      it('rejects a blank display name', async () => {
        const { service, actor } = await makeContext();
        await expect.rejects(
          () => service.updateProfile(actor.id, { displayName: '   ' }),
          DisplayNameRequiredError,
        );
      });

      it('leaves the email untouched — a profile update is not an address change', async () => {
        const { service, actor } = await makeContext();
        const updated = await service.updateProfile(actor.id, { displayName: 'Renamed' });
        expect.equal(updated.email, actor.email);
      });
    });

    describe('deleteAccount', () => {
      it('marks the account deleted rather than removing the record', async () => {
        const { service, actor, admin } = await makeContext();
        await service.deleteAccount(actor.id);
        const after = await service.getProfile(admin.id, actor.id);
        expect.ok(after.isDeleted, 'a deleted account is still readable');
      });

      it('makes the account unable to authenticate', async () => {
        const { service, actor, admin } = await makeContext();
        await service.deleteAccount(actor.id);
        const after = await service.getProfile(admin.id, actor.id);
        expect.equal(after.canAuthenticate(), false);
      });
    });

    describe('listUsers', () => {
      it('counts every account in meta.total and derives meta.totalPages from it', async () => {
        const { service, admin } = await makeContext();
        const page = await service.listUsers(admin.id, { page: 1, limit: 2 });
        expect.equal(page.meta.total, 3);
        expect.equal(page.meta.page, 1);
        expect.equal(page.meta.limit, 2);
        expect.equal(page.meta.totalPages, Math.ceil(page.meta.total / page.meta.limit));
        expect.equal(page.data.length, 2);
        expect.ok(page.data[0] instanceof User, 'listUsers must return real entities');
      });

      it('returns page 2 disjoint from page 1', async () => {
        const { service, admin } = await makeContext();
        const first = await service.listUsers(admin.id, { page: 1, limit: 2 });
        const second = await service.listUsers(admin.id, { page: 2, limit: 2 });
        expect.equal(second.data.length, 1);

        const firstIds = first.data.map((user) => String(user.id));
        const repeated = second.data.filter((user) => firstIds.includes(String(user.id)));
        expect.equal(repeated.length, 0, 'page 2 must not repeat a record from page 1');
      });
    });

    describe('setStatus', () => {
      it('suspending a verified account makes it unable to authenticate', async () => {
        const { service, actor, admin } = await makeContext();
        expect.ok(actor.canAuthenticate(), 'the world must start with an authenticable actor');

        const suspended = await service.setStatus(admin.id, actor.id, UserStatus.SUSPENDED);
        expect.equal(suspended.status, UserStatus.SUSPENDED);
        expect.equal(suspended.canAuthenticate(), false);
      });

      it('reinstating makes it able to authenticate again', async () => {
        const { service, actor, admin } = await makeContext();
        await service.setStatus(admin.id, actor.id, UserStatus.SUSPENDED);
        const reinstated = await service.setStatus(admin.id, actor.id, UserStatus.ACTIVE);
        expect.equal(reinstated.status, UserStatus.ACTIVE);
        expect.ok(reinstated.canAuthenticate());
      });

      it('rejects an id that does not exist', async () => {
        const { service, admin } = await makeContext();
        await expect.rejects(
          () => service.setStatus(admin.id, absentId, UserStatus.SUSPENDED),
          UserNotFoundError,
        );
      });
    });

    describe('setPlatformRole', () => {
      it('grants platform administration, and a later read agrees', async () => {
        const { service, other, admin } = await makeContext();
        const promoted = await service.setPlatformRole(
          admin.id,
          other.id,
          PlatformRole.PLATFORM_ADMIN,
        );
        expect.ok(promoted instanceof User, 'setPlatformRole must return a real entity');
        expect.equal(promoted.platformRole, PlatformRole.PLATFORM_ADMIN);

        const reread = await service.getProfile(admin.id, other.id);
        expect.equal(reread.platformRole, PlatformRole.PLATFORM_ADMIN);
      });

      // Withdrawal is tested on somebody else on purpose. Asking the world's
      // only administrator to demote itself would oblige every implementation
      // to permit exactly that, and an implementation is entitled — arguably
      // obliged — to refuse it, because the last administrator giving up
      // administration leaves the deployment with nobody able to operate it.
      it('withdraws it again', async () => {
        const { service, other, admin } = await makeContext();
        await service.setPlatformRole(admin.id, other.id, PlatformRole.PLATFORM_ADMIN);
        const demoted = await service.setPlatformRole(
          admin.id,
          other.id,
          PlatformRole.PLATFORM_USER,
        );
        expect.equal(demoted.platformRole, PlatformRole.PLATFORM_USER);

        const reread = await service.getProfile(admin.id, other.id);
        expect.equal(reread.platformRole, PlatformRole.PLATFORM_USER);
      });
    });

    describe('wire shape', () => {
      // The one assertion that makes two independent implementations agree on
      // the shape crossing between them. Both sides have to be load-bearing:
      // the left is what the service produced and serialized, the right is the
      // world the host promised. Comparing a round trip against itself would
      // prove only that the entity can serialize, which the entity's own tests
      // already establish and no implementation can get wrong.
      it('carries every field of the promised user out through the wire shape', async () => {
        const { service, actor } = await makeContext();
        const fetched = await service.getProfile(actor.id, actor.id);
        const revived = User.fromJSON(fetched.toJSON());
        expect.ok(revived instanceof User, 'fromJSON must produce a real entity');

        const actual = revived.toJSON();
        const promised = actor.toJSON();
        expect.equal(actual.id, promised.id);
        expect.equal(actual.email, promised.email);
        expect.equal(actual.displayName, promised.displayName);
        expect.equal(actual.status, promised.status);
        expect.equal(actual.platformRole, promised.platformRole);
        expect.equal(actual.emailVerifiedAt, promised.emailVerifiedAt);
        expect.equal(actual.createdAt, promised.createdAt);
        expect.equal(actual.updatedAt, promised.updatedAt);
        expect.equal(actual.deletedAt, promised.deletedAt);
      });
    });
  });
}
