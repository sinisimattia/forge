import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IIdentityService } from '../contracts/IIdentityService';
import type { AuthIdentity } from '../entities/AuthIdentity';
import type { AuthIdentityId } from '../types/AuthIdentityId';

/**
 * One isolated world, built fresh for each test.
 *
 * Two users, not three. The second one holds exactly one identity and plays
 * both of the parts the suite needs a second user for — see `soleIdentityId`.
 */
export interface IdentityServiceContractContext {
  /** The implementation under test, holding exactly the identities described below. */
  service: IIdentityService;
  /**
   * A user holding **more than one** identity, so that one of them can be
   * unlinked without meeting the last-identity rule.
   */
  actorId: UserId;
  /**
   * Exactly the identities the world holds for `actorId`, as entities.
   *
   * At least two, and at least one of them a {@link AuthProvider.PASSWORD}
   * identity seeded from `passwordAccountIdAsGiven`. These are the right-hand
   * side of every comparison the suite makes: what the service returns is
   * checked against the world the host promised, never against itself.
   */
  actorIdentities: readonly AuthIdentity[];
  /**
   * The account identifier the world's password identity was **built from**,
   * which must *not* already be in normal form — mixed case, with surrounding
   * whitespace.
   *
   * It is what makes the wire-shape assertion bite. An implementation that
   * hands back the row its store holds, rather than rebuilding the entity from
   * it, returns a `providerAccountId` that differs from the promised one in a
   * visible way; seed the normal form instead and that field becomes identical
   * on both sides whatever the implementation does. The suite checks this
   * promise before relying on it, so a world that got it wrong fails loudly
   * rather than quietly proving nothing.
   */
  passwordAccountIdAsGiven: string;
  /** A second user, holding exactly one identity. */
  soleIdentityUserId: UserId;
  /**
   * That second user's **only** identity.
   *
   * It plays two parts, and the "only" is what makes the second one work. As
   * the sole identity of its owner it is what `LastIdentityRemovalError` is
   * tested with. As an identity the *actor* does not hold it is what the
   * ownership tests are run against — and because it is its owner's last one,
   * an implementation that checked the count before ownership would refuse it
   * with `LastIdentityRemovalError` and fail the suite. Give the second user a
   * spare identity and that implementation passes the count check, falls
   * through to ownership, answers `IdentityNotFoundError` and goes undetected.
   */
  soleIdentityId: AuthIdentityId;
}

/** Runner primitives + the world factory the shared suite needs. */
export interface IIdentityServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly the identities it describes. */
  makeContext: () => Promise<IdentityServiceContractContext>;
  /**
   * An id that is well-formed for the host's store but present in no world it
   * builds.
   *
   * The suite cannot invent one: what counts as well-formed differs between
   * stores, and a store that validates the shape of an id would reject a made-up
   * string before ever looking for it — failing the suite for the wrong reason,
   * with the wrong error. The host knows its own id format; the suite only needs
   * the guarantee that nothing answers to this one.
   */
  absentIdentityId: AuthIdentityId;
}
