import { normalizeEmail } from '../../shared/policies/normalizeEmail';
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

      // The world was built from an address that is not in normal form, so an
      // implementation that hands back the address it was given fails here.
      //
      // ## Two right-hand sides, and the first one is the load-bearing one
      //
      // `normalizeEmail(actorEmailAsGiven)` comes from the address the world
      // says it was given and from the domain's own rule — from neither the
      // store, nor the implementation, nor the host's own mapping of a row.
      // `actor.email` comes from the world. Both are compared, and they catch
      // different things: the second catches a service that answers about some
      // other account, the first catches a service that answers about the right
      // account in the wrong form.
      //
      // The first one is here because the second is not enough, and the gap was
      // real rather than theoretical. A host is free to build the `actor` it
      // promises by *calling the service it is testing* — nothing here can stop
      // it, and it is the obvious thing to write. Do that and `profile.email`
      // and `actor.email` are one value compared with itself: unfailable, and
      // silently so. The first comparison fails for that host, because
      // `normalizeEmail` of the seed is not something the implementation gets a
      // vote on.
      //
      // ## The guard, and what it used to be
      //
      // It asserts a property of the **seed**: that the address the world says
      // it was given is one the domain has to change. That is checkable here and
      // is the whole of what a host can get wrong about it.
      //
      // It used to read `actor.email !== actorEmailAsGiven`, which looks like the
      // same claim and is not. `actor` is an entity, `User` normalizes
      // unconditionally, so that comparison was true whenever the seed was
      // non-normal **whatever the store held** — it could never detect the
      // condition it was written to detect. Worse, an implementation that failed
      // to normalize anywhere could make it *false*, and it would then report
      // "the world must seed…" and blame the host for a defect in the service.
      // A guard that cannot fail for its own reason, and can fail for somebody
      // else's, is worse than no guard.
      it('returns the address in normal form, not the form the world was given', async () => {
        const { service, actor, actorEmailAsGiven } = await makeContext();
        expect.ok(
          actorEmailAsGiven !== normalizeEmail(actorEmailAsGiven),
          'the world must seed the actor from an address the domain has to normalize',
        );

        const profile = await service.getProfile(actor.id, actor.id);
        expect.equal(
          profile.email,
          normalizeEmail(actorEmailAsGiven),
          'the address must come back in the normal form of the one the world was given',
        );
        expect.equal(profile.email, actor.email, 'and must be the promised user\'s address');
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
      //
      // It reads the payload the service emitted, and nothing downstream of it.
      // Reviving through `fromJSON` re-runs the entity's invariants — it
      // normalizes the address and trims the display name — so comparing a
      // revived round trip launders exactly the faults this test exists to
      // catch: an implementation that rebuilt the entity and then patched
      // `email` back from its stored row emits `"  Ada@Example.COM "` here, and
      // `User.fromJSON(...).toJSON()` would turn that back into
      // `"ada@example.com"` before the comparison ever saw it.
      //
      // It reads the actor on purpose. That is the user the world seeded in a
      // form the domain has to normalize, so an implementation that hands back
      // its stored row instead of rebuilding the entity from it differs from
      // the promised user in a field this test reads — which is why the seeding
      // is asserted before anything is compared.
      it('carries every field of the promised user out through the wire shape', async () => {
        const { service, actor, actorEmailAsGiven } = await makeContext();
        expect.ok(
          actorEmailAsGiven !== normalizeEmail(actorEmailAsGiven),
          'the world must seed the actor from an address the domain has to normalize',
        );

        const fetched = await service.getProfile(actor.id, actor.id);

        const actual = fetched.toJSON();
        const promised = actor.toJSON();
        expect.equal(actual.id, promised.id);
        // Against the seed put through the domain's rule as well as against the
        // promised user, for the reason the normalization test above states at
        // length: a host that built `actor` by calling the service under test
        // makes the second comparison a value against itself, and only the first
        // one survives that.
        expect.equal(
          actual.email,
          normalizeEmail(actorEmailAsGiven),
          'the emitted address must be the normal form of the one the world was given',
        );
        expect.equal(actual.email, promised.email);
        expect.equal(actual.displayName, promised.displayName);
        expect.equal(actual.status, promised.status);
        expect.equal(actual.platformRole, promised.platformRole);
        expect.equal(actual.emailVerifiedAt, promised.emailVerifiedAt);
        expect.equal(actual.createdAt, promised.createdAt);
        expect.equal(actual.updatedAt, promised.updatedAt);
        expect.equal(actual.deletedAt, promised.deletedAt);

        // The other half of "two implementations agree on the shape between
        // them": whatever this one emits, the receiving side has to be able to
        // rebuild. Failable, and not a statement about `fromJSON`'s return
        // type — `fromJSON` re-runs every invariant and *throws* on a payload
        // that violates one, so an implementation emitting an unacceptable wire
        // shape fails on this line rather than on the assertion.
        const revived = User.fromJSON(actual);
        expect.ok(revived instanceof User, 'the emitted payload must survive the reviver');
      });
    });
  });
}
