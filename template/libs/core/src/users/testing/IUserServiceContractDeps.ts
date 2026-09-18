import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { IUserService } from '../contracts/IUserService';
import type { User } from '../entities/User';
import type { UserId } from '../types/UserId';

/** One isolated world, built fresh for each test. */
export interface UserServiceContractContext {
  /** The implementation under test, holding exactly the three users below. */
  service: IUserService;
  /**
   * An ordinary, active, verified user, built from `actorEmailAsGiven` and
   * therefore carrying the normal form of it.
   *
   * It is the right-hand side of every comparison the suite makes about a
   * profile: what the service returns is checked against the world the host
   * promised, never against itself.
   */
  actor: User;
  /**
   * The address `actor` was **built from**, which must *not* already be in
   * normal form — mixed case, with surrounding whitespace.
   *
   * It is what makes normalization observable. An implementation that hands
   * back the address its store holds, rather than rebuilding the entity from
   * it, returns an `email` that differs from the promised one in a visible way;
   * seed the normal form instead and that field becomes identical on both sides
   * whatever the implementation does. The suite checks this promise before
   * relying on it, so a world that got it wrong fails loudly rather than
   * quietly proving nothing.
   */
  actorEmailAsGiven: string;
  /**
   * A second ordinary, active, verified user.
   *
   * It exists so the world holds more records than one page of two, and so an
   * administrator can act on somebody other than itself — which is what lets
   * the suite test withdrawing platform administration without also demanding
   * that the last administrator be allowed to demote itself.
   */
  other: User;
  /** A platform administrator, active and verified. */
  admin: User;
}

/** Runner primitives + the world factory the shared suite needs. */
export interface IUserServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly the three users it returns. */
  makeContext: () => Promise<UserServiceContractContext>;
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
  absentId: UserId;
}
