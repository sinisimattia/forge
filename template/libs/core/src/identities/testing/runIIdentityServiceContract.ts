import { AuthIdentity } from '../entities/AuthIdentity';
import { AuthProvider } from '../enums/AuthProvider';
import { IdentityNotFoundError } from '../errors/IdentityNotFoundError';
import { LastIdentityRemovalError } from '../errors/LastIdentityRemovalError';
import type { IIdentityServiceContractDeps } from './IIdentityServiceContractDeps';

/** The key set an identity serializes to. Anything else is a leak or a loss. */
const DOCUMENTED_KEYS = 'createdAt,id,lastUsedAt,provider,providerAccountId,userId';

/**
 * The behavior every {@link IIdentityService} implementation must exhibit.
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
export function runIIdentityServiceContract(deps: IIdentityServiceContractDeps): void {
  const { describe, it, expect, makeContext, absentIdentityId } = deps;

  describe('IIdentityService conformance', () => {
    describe('listIdentities', () => {
      it('returns the actor\'s identities and nothing else, as real entities', async () => {
        const { service, actorId, actorIdentities, otherUsersIdentityId } = await makeContext();
        const listed = await service.listIdentities(actorId);

        const impostors = listed.filter((identity) => !(identity instanceof AuthIdentity));
        expect.equal(impostors.length, 0, 'listIdentities must return real entities');

        expect.equal(listed.length, actorIdentities.length);
        const listedIds = listed.map((identity) => String(identity.id));
        const absent = actorIdentities
          .map((identity) => String(identity.id))
          .filter((id) => !listedIds.includes(id));
        expect.equal(absent.length, 0, 'every identity the world promised must come back');
        expect.equal(
          listedIds.includes(String(otherUsersIdentityId)),
          false,
          'another user\'s identity must never appear',
        );
      });

      // The world was built from an account identifier that is not in normal
      // form, and the promised entity carries the normal form; comparing the two
      // is what an implementation returning the identifier it was given fails.
      it('returns a password identity in normal form, not the form the world was given', async () => {
        const {
          service,
          actorId,
          actorIdentities,
          passwordAccountIdAsGiven,
        } = await makeContext();

        const promised = actorIdentities
          .filter((identity) => identity.provider === AuthProvider.PASSWORD)[0];
        expect.ok(promised, 'the world must hold a password identity for the actor');
        expect.ok(
          promised.providerAccountId !== passwordAccountIdAsGiven,
          'the world must be built from an account identifier not already in normal form',
        );

        const listed = await service.listIdentities(actorId);
        const found = listed.filter((identity) => identity.id === promised.id)[0];
        expect.ok(found, 'the promised password identity must come back');
        expect.equal(found.providerAccountId, promised.providerAccountId);
      });

      // The structural half of "identities carry no secret material" (ADR-0005).
      // The right-hand side is the documented key set, so the day somebody adds
      // a derivation to the entity for convenience this fails rather than ships.
      it('serializes exactly the documented keys, and no secret material', async () => {
        const { service, actorId } = await makeContext();
        const listed = await service.listIdentities(actorId);
        const keys = Object.keys(listed[0].toJSON()).sort().join(',');
        expect.equal(
          keys,
          DOCUMENTED_KEYS,
          'an identity may carry no derivation, salt or parameter of one',
        );
      });
    });

    describe('unlinkIdentity', () => {
      it('removes an identity from a user who has more than one', async () => {
        const { service, actorId, actorIdentities } = await makeContext();
        const removed = actorIdentities[0];
        await service.unlinkIdentity(actorId, removed.id);

        const listed = await service.listIdentities(actorId);
        expect.equal(listed.length, actorIdentities.length - 1);
        expect.equal(
          listed.map((identity) => String(identity.id)).includes(String(removed.id)),
          false,
          'the unlinked identity must be gone',
        );
      });

      it('refuses to remove the only identity a user has', async () => {
        const { service, soleIdentityUserId, soleIdentityId } = await makeContext();
        await expect.rejects(
          () => service.unlinkIdentity(soleIdentityUserId, soleIdentityId),
          LastIdentityRemovalError,
        );
      });

      // Refusing after removing would be no refusal at all.
      it('leaves the last identity in place after refusing to remove it', async () => {
        const { service, soleIdentityUserId, soleIdentityId } = await makeContext();
        await expect.rejects(
          () => service.unlinkIdentity(soleIdentityUserId, soleIdentityId),
          LastIdentityRemovalError,
        );

        const listed = await service.listIdentities(soleIdentityUserId);
        expect.equal(listed.length, 1);
        expect.equal(String(listed[0].id), String(soleIdentityId));
      });

      it('refuses an identity that belongs to another user', async () => {
        const { service, actorId, otherUsersIdentityId } = await makeContext();
        await expect.rejects(
          () => service.unlinkIdentity(actorId, otherUsersIdentityId),
          IdentityNotFoundError,
        );
      });

      it('refuses an id that does not exist', async () => {
        const { service, actorId } = await makeContext();
        await expect.rejects(
          () => service.unlinkIdentity(actorId, absentIdentityId),
          IdentityNotFoundError,
        );
      });

      // Asserted explicitly rather than left to the two tests above: an
      // implementation that answered "not yours" and "no such thing"
      // differently would satisfy both of them and still hand a caller a way to
      // discover which ids exist by trying them.
      it('answers identically for another user\'s identity and a missing one', async () => {
        const { service, actorId, otherUsersIdentityId } = await makeContext();
        const foreign: unknown = await service
          .unlinkIdentity(actorId, otherUsersIdentityId)
          .catch((error: unknown) => error);
        const missing: unknown = await service
          .unlinkIdentity(actorId, absentIdentityId)
          .catch((error: unknown) => error);

        expect.ok(
          foreign instanceof IdentityNotFoundError,
          'another user\'s identity must be reported as not found',
        );
        expect.ok(
          missing instanceof IdentityNotFoundError,
          'a missing identity must be reported as not found',
        );
        expect.equal(
          (foreign as Error).constructor,
          (missing as Error).constructor,
          'the two cases must be indistinguishable to the caller',
        );
      });
    });

    describe('wire shape', () => {
      // The one assertion that makes two independent implementations agree on
      // the shape crossing between them. Both sides have to be load-bearing:
      // the left is what the service produced and serialized, the right is the
      // world the host promised. Comparing a round trip against itself would
      // prove only that the entity can serialize, which the entity's own tests
      // already establish and no implementation can get wrong.
      it('carries every field of the promised identity out through the wire shape', async () => {
        const { service, actorId, actorIdentities } = await makeContext();
        const promised = actorIdentities[0];

        const listed = await service.listIdentities(actorId);
        const fetched = listed.filter((identity) => identity.id === promised.id)[0];
        expect.ok(fetched, 'the promised identity must come back');

        const revived = AuthIdentity.fromJSON(fetched.toJSON());
        expect.ok(revived instanceof AuthIdentity, 'fromJSON must produce a real entity');

        const actual = revived.toJSON();
        const expected = promised.toJSON();
        expect.equal(actual.id, expected.id);
        expect.equal(actual.userId, expected.userId);
        expect.equal(actual.provider, expected.provider);
        expect.equal(actual.providerAccountId, expected.providerAccountId);
        expect.equal(actual.createdAt, expected.createdAt);
        expect.equal(actual.lastUsedAt, expected.lastUsedAt);
      });
    });
  });
}
