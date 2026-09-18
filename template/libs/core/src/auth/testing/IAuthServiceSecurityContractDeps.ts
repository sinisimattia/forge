import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IAuthService } from '../contracts/IAuthService';

/**
 * One isolated world for the security suite, built fresh for each test.
 *
 * Four accounts, one per state an attempt can be refused for, each seeded with
 * the **correct** secret. That is what makes the suite discriminating: every
 * refusal it asserts has to be the account's state and cannot be the secret,
 * and a host that seeded the wrong secret gets `INVALID_SECRET` back and fails
 * the assertion rather than passing it for the wrong reason.
 *
 * This world can only be built by an implementation that owns its own store — a
 * suspended account and a soft-deleted one are not states any caller can put an
 * account into from outside. That is why this suite is driven by one
 * implementation and the shared one is driven by every implementation.
 */
export interface AuthServiceSecurityContractContext {
  /** The implementation under test, holding exactly the world described below. */
  service: IAuthService;

  /** A verified, usable account. */
  actorId: UserId;
  /** The actor's address, as the world was given it. */
  actorEmail: string;
  /** The secret the actor's account was seeded with. */
  actorSecret: string;
  /** A valid, unconsumed password-reset token for the actor. */
  actorReset: string;

  /** An account that has registered but never proven its address. */
  pendingUserId: UserId;
  /** The pending account's address. */
  pendingEmail: string;
  /** The **correct** secret for the pending account. */
  pendingSecret: string;

  /** A verified account an administrator has blocked. */
  suspendedEmail: string;
  /** The **correct** secret for the suspended account. */
  suspendedSecret: string;

  /** A verified account that has been soft-deleted. */
  deletedEmail: string;
  /** The **correct** secret for the soft-deleted account. */
  deletedSecret: string;

  /** An address no account in this world answers to. */
  unknownEmail: string;
  /** A secret this deployment's policy accepts, different from every seeded one. */
  replacementSecret: string;
}

/** Runner primitives + the world factory the security suite needs. */
export interface IAuthServiceSecurityContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it describes. */
  makeContext: () => Promise<AuthServiceSecurityContractContext>;
}
