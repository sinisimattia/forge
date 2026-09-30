import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IMfaService } from '../contracts/IMfaService';
import type { MfaMethodId } from '../types/MfaMethodId';

/**
 * One isolated world for the security suite, built fresh for each test.
 *
 * The actor's confirmed method is seeded directly by the host rather than
 * through the contract — not because a caller could not build one (it
 * could; see `MfaServiceContractContext`'s `validCodeFor`), but so that
 * verifying it costs the world-builder nothing beyond stating the secret it
 * answers to. What could **not** be built from outside, and is the actual
 * reason this suite exists (see this suite's own TSDoc and DEC-1 in
 * `libs/core/README.md`), is the store's own row for a batch of recovery
 * codes: no `IMfaService` method returns a persisted value, so only the
 * implementation that owns the store can hand that back to a test honestly.
 */
export interface MfaServiceSecurityContractContext {
  /** The implementation under test. */
  service: IMfaService;
  /** A user holding exactly one confirmed method. */
  actorId: UserId;
  /** The actor's own confirmed method. */
  actorMethodId: MfaMethodId;
  /**
   * Computes a code that verifies against `actorMethodId` right now — see
   * the same requirement on `validCodeFor` in the shared suite's deps for
   * why this is a function rather than a precomputed value.
   */
  computeActorCode: () => string;
  /**
   * Reads the raw values persisted for the actor's current recovery codes,
   * in whatever form the store actually holds them — a digest, if the
   * implementation is correct.
   *
   * Only meaningful after a batch has been minted for the actor. Reading the
   * store directly, rather than through any method this contract offers, is
   * exactly the capability DEC-1 restricts to the security suite: no
   * `IMfaService` method could honestly answer "what did you write to
   * disk", and a caller of this contract is never meant to be able to ask.
   */
  readStoredRecoveryCodeValues: () => Promise<readonly string[]>;
}

/** Runner primitives + the world factory the security suite needs. */
export interface IMfaServiceSecurityContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it describes. */
  makeContext: () => Promise<MfaServiceSecurityContractContext>;
}
