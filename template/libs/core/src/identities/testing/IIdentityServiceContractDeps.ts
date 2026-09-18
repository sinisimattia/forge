import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IIdentityService } from '../contracts/IIdentityService';
import type { AuthIdentity } from '../entities/AuthIdentity';
import type { AuthIdentityId } from '../types/AuthIdentityId';

/** One isolated world, built fresh for each test. */
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
   * That difference is what makes normalization observable: an implementation
   * handing back the identifier it was given, rather than the one the domain
   * defines, returns something the promised entity does not equal. The suite
   * checks this promise before relying on it, so a world that seeded the normal
   * form fails loudly instead of making the assertion vacuous.
   */
  passwordAccountIdAsGiven: string;
  /**
   * An identity belonging to a **different** user, who must also hold more than
   * one.
   *
   * The second user needs a spare identity for the same reason the actor does:
   * if the foreign identity were somebody's only one, an implementation that
   * checked the count before ownership could raise
   * `LastIdentityRemovalError` and still look correct, and the suite would have
   * proved nothing about whose identity it was.
   */
  otherUsersIdentityId: AuthIdentityId;
  /** A third user holding exactly one identity. */
  soleIdentityUserId: UserId;
  /** That third user's only identity. */
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
