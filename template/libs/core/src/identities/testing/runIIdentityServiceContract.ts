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
 * That rule is why normalization has no test of its own here. Every value this
 * contract returns is an `AuthIdentity`, and the constructor normalizes a
 * password identifier unconditionally, so at this surface no implementation can
 * hand back an unnormalized one *through an entity*. The failable form of that
 * property lives in the entity's own suite; what remains failable here is
 * whether an entity was built at all, which the `instanceof` check below asserts
 * directly and the wire-shape test asserts again from the other side.
 *
 * @param deps - the host runner's primitives, a fresh-world factory, and an id
 * well-formed for the host's store that no world contains
 */
export function runIIdentityServiceContract(deps: IIdentityServiceContractDeps): void {
  const { describe, it, expect, makeContext, absentIdentityId } = deps;

  describe('IIdentityService conformance', () => {
    describe('listIdentities', () => {
      it('returns the actor\'s identities and nothing else, as real entities', async () => {
        const { service, actorId, actorIdentities, soleIdentityId } = await makeContext();
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
          listedIds.includes(String(soleIdentityId)),
          false,
          'another user\'s identity must never appear',
        );
      });

      // The structural half of "identities carry no secret material" (ADR-0005).
      // The right-hand side is the documented key set, so the day somebody adds
      // a derivation to the entity for convenience this fails rather than ships.
      it('serializes exactly the documented keys, and no secret material', async () => {
        const { service, actorId } = await makeContext();
        const listed = await service.listIdentities(actorId);
        const first = listed[0];
        expect.ok(first, 'the actor must hold at least one identity to serialize');

        const keys = Object.keys(first.toJSON()).sort().join(',');
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

      // `soleIdentityId` is its owner's last identity, which is what gives this
      // test its teeth: an implementation that asked "would this be the last
      // one?" before asking "is this yours?" refuses with
      // LastIdentityRemovalError and fails here.
      it('refuses an identity that belongs to another user', async () => {
        const { service, actorId, soleIdentityId } = await makeContext();
        await expect.rejects(
          () => service.unlinkIdentity(actorId, soleIdentityId),
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
        const { service, actorId, soleIdentityId } = await makeContext();
        const foreign: unknown = await service
          .unlinkIdentity(actorId, soleIdentityId)
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
        // Documentation rather than a guard: the two checks above already fix
        // both constructors. Kept because the property under test is "these two
        // cases are the same error", and a reader should find that written down
        // rather than inferred from two separate instanceof checks.
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
      //
      // It runs against the password identity on purpose. That is the one the
      // world seeded in a form the domain has to normalize, so an implementation
      // that hands back its stored row instead of rebuilding the entity from it
      // differs from the promised identity in a field this test reads.
      it('carries every field of the promised identity out through the wire shape', async () => {
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
          'the world must seed the password identity in a form the domain has to normalize',
        );

        const listed = await service.listIdentities(actorId);
        const fetched = listed.filter((identity) => identity.id === promised.id)[0];
        expect.ok(fetched, 'the promised identity must come back');

        // Compared BEFORE any round trip, and that is the whole point. Reviving
        // through `fromJSON` re-runs the entity's invariants, so a round trip
        // launders exactly the faults this test exists to catch: an
        // implementation that rebuilt the entity and then patched
        // `providerAccountId` back from its stored row emits the raw form here,
        // and `AuthIdentity.fromJSON(...).toJSON()` would normalize it away
        // again before the comparison ever saw it.
        const actual = fetched.toJSON();
        const expected = promised.toJSON();
        expect.equal(actual.id, expected.id);
        expect.equal(actual.userId, expected.userId);
        expect.equal(actual.provider, expected.provider);
        expect.equal(actual.providerAccountId, expected.providerAccountId);
        expect.equal(actual.createdAt, expected.createdAt);
        expect.equal(actual.lastUsedAt, expected.lastUsedAt);

        // The other half of "two implementations agree on the shape between
        // them": whatever this one emits, the receiving side has to be able to
        // rebuild. Failable, and not a statement about `fromJSON`'s return
        // type — `fromJSON` re-runs every invariant and *throws* on a payload
        // that violates one, so an implementation emitting an unacceptable
        // wire shape fails on this line rather than on the assertion.
        const revived = AuthIdentity.fromJSON(actual);
        expect.ok(revived instanceof AuthIdentity, 'the emitted payload must survive the reviver');
      });
    });
  });
}
