import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { IUserService } from '../contracts/IUserService';
import type { User } from '../entities/User';
import type { UserId } from '../types/UserId';

/** One isolated world, built fresh for each test. */
export interface UserServiceContractContext {
  /** The implementation under test, holding exactly the three users below. */
  service: IUserService;
  /**
   * An ordinary, active, verified user.
   *
   * The world must be built from an address that is **not** already in normal
   * form — mixed case, with surrounding whitespace — while this entity carries
   * the normal form. That difference is what makes normalization observable: an
   * implementation handing back the address it was given, rather than the one
   * the domain defines, returns something this user does not equal.
   */
  actor: User;
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
