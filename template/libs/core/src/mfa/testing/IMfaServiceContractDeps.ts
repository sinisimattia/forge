import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IMfaService } from '../contracts/IMfaService';
import type { MfaMethodId } from '../types/MfaMethodId';
import type { TotpEnrollmentOffer } from '../types/TotpEnrollmentOffer';

/**
 * One isolated world, built fresh for each test.
 *
 * Two users and nothing pre-enrolled for either. The suite mints and
 * confirms every method it needs through the contract itself — the same
 * `beginTotpEnrollment` / `confirmTotpEnrollment` pair any real caller would
 * use — rather than asking the host to seed one directly, so the world this
 * contract needs is exactly the world every implementation is capable of
 * building on its own.
 */
export interface MfaServiceContractContext {
  /** The implementation under test. */
  service: IMfaService;
  /** A user with nothing enrolled at the start of the test. */
  actorId: UserId;
  /**
   * A second user, also with nothing enrolled at the start of the test.
   *
   * Exists so that "the actor's own methods, and nothing else" is a real
   * assertion rather than one with nothing on the other side of it: without
   * a second user holding a method of their own, a listing that happened to
   * return every method in the store would still pass.
   */
  otherUserId: UserId;
  /**
   * Computes the code that verifies against a freshly offered enrollment,
   * right now.
   *
   * TOTP codes are time-based, so the suite cannot know in advance what a
   * verifying code looks like the way it can know a fixed password — only
   * whatever implements the offer knows that. Called immediately after the
   * matching `beginTotpEnrollment`, never cached across an `await`, so that
   * a narrow verification window is never the reason this suite is flaky.
   *
   * @param offer - the offer `beginTotpEnrollment` just returned
   * @returns a code that verifies against `offer` at the moment this is called
   */
  validCodeFor: (offer: TotpEnrollmentOffer) => string;
  /**
   * An id that is well-formed for the host's store but present in no world
   * it builds.
   *
   * The suite cannot invent one: what counts as well-formed differs between
   * stores, and a store that validates the shape of an id would reject a
   * made-up string before ever looking for it — failing the suite for the
   * wrong reason, with the wrong error. The host knows its own id format;
   * the suite only needs the guarantee that nothing answers to this one.
   */
  absentMethodId: MfaMethodId;
}

/** Runner primitives + the world factory the shared suite needs. */
export interface IMfaServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it describes. */
  makeContext: () => Promise<MfaServiceContractContext>;
}
