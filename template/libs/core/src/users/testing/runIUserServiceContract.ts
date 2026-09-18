import { normalizeEmail } from '../../shared/policies/normalizeEmail';
import { User } from '../entities/User';
import { PlatformRole } from '../enums/PlatformRole';
import { UserStatus } from '../enums/UserStatus';
import { DisplayNameRequiredError } from '../errors/DisplayNameRequiredError';
import { UserNotFoundError } from '../errors/UserNotFoundError';
import type { UserId } from '../types/UserId';
import type { IUserServiceContractDeps } from './IUserServiceContractDeps';

/** An id no world contains, used to prove an unknown target is refused. */
const ABSENT_ID = 'no-such-user' as UserId;

/**
 * The behavior every {@link IUserService} implementation must exhibit.
 *
 * Each implementation drives this suite with its own runner's
 * `describe`/`it`/`expect`, which is what makes "they behave the same" a fact
 * the build checks rather than a claim a reviewer makes. The suite asserts
 * behavior only: who is *allowed* to do these things is enforced where the
 * implementation lives, and is held to its own suite there.
 *
 * @param deps - the host runner's primitives plus a fresh-world factory
 */
export function runIUserServiceContract(deps: IUserServiceContractDeps): void {
  const { describe, it, expect, makeContext } = deps;

  describe('IUserService conformance', () => {
    describe('getProfile', () => {
      it('returns the actor\'s own profile', async () => {
        const { service, actor } = await makeContext();
        const profile = await service.getProfile(actor.id, actor.id);
        expect.ok(profile instanceof User, 'getProfile must return a real entity');
        expect.equal(profile.id, actor.id);
        expect.equal(profile.displayName, actor.displayName);
      });

      it('returns a profile whose email is in normal form', async () => {
        const { service, actor } = await makeContext();
        const profile = await service.getProfile(actor.id, actor.id);
        expect.equal(profile.email, normalizeEmail(profile.email));
      });

      it('rejects an id that does not exist', async () => {
        const { service, actor } = await makeContext();
        await expect.rejects(
          () => service.getProfile(actor.id, ABSENT_ID),
          UserNotFoundError,
        );
      });
    });

    describe('updateProfile', () => {
      it('changes the display name and returns the updated user', async () => {
        const { service, actor } = await makeContext();
        const updated = await service.updateProfile(actor.id, { displayName: 'Ada Lovelace' });
        expect.equal(updated.displayName, 'Ada Lovelace');

        const reread = await service.getProfile(actor.id, actor.id);
        expect.equal(reread.displayName, 'Ada Lovelace');
      });

      // Trimming is an invariant of the entity, so any implementation returning a
      // real `User` gets it for free. What this still discriminates is an
      // implementation that hands back whatever its store or its peer gave it
      // without rebuilding the entity from it — which is why the instance check
      // above and this assertion belong together.
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
        const before = actor.email;
        const updated = await service.updateProfile(actor.id, { displayName: 'Renamed' });
        expect.equal(updated.email, before);
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
          () => service.setStatus(admin.id, ABSENT_ID, UserStatus.SUSPENDED),
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
        expect.equal(promoted.platformRole, PlatformRole.PLATFORM_ADMIN);

        const reread = await service.getProfile(admin.id, other.id);
        expect.equal(reread.platformRole, PlatformRole.PLATFORM_ADMIN);
      });

      it('withdraws it again', async () => {
        const { service, admin } = await makeContext();
        const demoted = await service.setPlatformRole(
          admin.id,
          admin.id,
          PlatformRole.PLATFORM_USER,
        );
        expect.equal(demoted.platformRole, PlatformRole.PLATFORM_USER);
      });
    });

    describe('wire shape', () => {
      // The one assertion that makes two independent implementations provably
      // agree on the shape that crosses between them: whatever one writes, the
      // other can rebuild without losing a field.
      it('survives the round trip through the wire shape in every field', async () => {
        const { service, actor } = await makeContext();
        const user = await service.getProfile(actor.id, actor.id);
        const json = user.toJSON();
        const revived = User.fromJSON(json);
        expect.ok(revived instanceof User, 'fromJSON must produce a real entity');

        const again = revived.toJSON();
        expect.equal(again.id, json.id);
        expect.equal(again.email, json.email);
        expect.equal(again.displayName, json.displayName);
        expect.equal(again.status, json.status);
        expect.equal(again.platformRole, json.platformRole);
        expect.equal(again.emailVerifiedAt, json.emailVerifiedAt);
        expect.equal(again.createdAt, json.createdAt);
        expect.equal(again.updatedAt, json.updatedAt);
        expect.equal(again.deletedAt, json.deletedAt);
      });
    });
  });
}
