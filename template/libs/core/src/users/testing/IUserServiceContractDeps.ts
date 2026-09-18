import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { IUserService } from '../contracts/IUserService';
import type { User } from '../entities/User';

/** One isolated world, built fresh for each test. */
export interface UserServiceContractContext {
  /** The implementation under test, holding exactly the three users below. */
  service: IUserService;
  /** An ordinary, active, verified user. */
  actor: User;
  /** A second ordinary, active, verified user, so a test can prove one person's data is not another's. */
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
}
