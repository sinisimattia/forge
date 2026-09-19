import type { ConformanceExpect } from '../../shared/testing/ConformanceExpect';
import type { UserId } from '../../users/types/UserId';
import type { IAuthService } from '../contracts/IAuthService';
import type { Session } from '../entities/Session';
import type { SessionId } from '../types/SessionId';

/**
 * One isolated world, built fresh for each test.
 *
 * Three accounts, each of which exists because one assertion cannot be made
 * without it: an actor who can sign in, a second user whose session the actor
 * must not be able to reach, and an account that has registered but never
 * proven its address.
 *
 * Members described as being in a form the domain has to change are not
 * decoration: they are what stops the suite comparing a value against a function
 * of itself, which would pass for an implementation that never built an entity at
 * all. The suite asserts each of those promises before relying on it, so a world
 * that got one wrong fails loudly rather than quietly proving nothing — with one
 * exception, which says so on its own doc.
 */
export interface AuthServiceContractContext {
  /** The implementation under test, holding exactly the world described below. */
  service: IAuthService;

  /** A verified, usable account: the one the suite signs in as. */
  actorId: UserId;
  /**
   * The actor's address **as the world was given it**, which must *not* already
   * be in normal form — mixed case, with surrounding whitespace.
   *
   * It is what makes "the outcome names the right person" a failable assertion.
   * Seed the normal form instead and an implementation that returns some other
   * account's address, or hands back its stored row without ever building a
   * user, can still match on this field.
   */
  actorEmailAsGiven: string;
  /** The secret the actor's account was seeded with. */
  actorSecret: string;
  /**
   * The **only** session the world holds for the actor, as an entity.
   *
   * It is the right-hand side of the wire-shape comparison — what the service
   * returns is checked against the world the host promised, never against
   * itself — and it must be usable at the moment the suite runs, since every
   * test that reads the actor's sessions expects to find it.
   *
   * ## Its client context must be the one the world ASKED FOR
   *
   * `clientAddress` and `clientLabel` are the two fields a host is most likely
   * to fill in by reading its own store, and doing so is what makes the
   * wire-shape comparison stop working. An implementation that never persisted
   * the client at all then has `null` on the left and `null` on the right, and
   * the two agree — while a person looking at their own session list is shown
   * nulls where another implementation shows values. That is not a hypothetical:
   * it was injected as a fault and the whole suite stayed green.
   *
   * So these two fields carry what the world supplied when it opened the
   * session, in the same spirit as {@link actorEmailAsGiven} — a value the
   * implementation gets no vote on. The rest of the session is whatever the
   * host's store says, because only the store knows it.
   */
  actorSession: Session;
  /** A second user, who holds a session of their own. */
  otherUserId: UserId;
  /** That second user's session. The actor must not be able to see or end it. */
  otherUserSessionId: SessionId;

  /** An account that has registered but never proven its address. */
  pendingEmail: string;
  /** The secret that pending account was seeded with. */
  pendingSecret: string;
  /** A valid, unconsumed verification token for `pendingEmail`. */
  pendingVerification: string;
  /**
   * A verification token for `pendingEmail` whose lifetime has run out.
   *
   * The one promise on this interface the suite cannot check before leaning on
   * it. Every other obligation here fails loudly when a host gets it wrong;
   * this one cannot, because `ExpiredTokenError` is deliberately what an
   * *unknown* token raises too — so a host that supplied a value nobody ever
   * issued passes the test it was meant to fail. Said out loud rather than left
   * implicit, because the exception is the interesting part.
   */
  expiredVerification: string;

  /** An address no account in this world answers to. */
  unknownEmail: string;
  /** A secret this deployment's policy refuses. */
  weakSecret: string;
  /**
   * A secret this deployment's policy accepts, different from every other
   * secret in the world — so that "the change took effect" is distinguishable
   * from "nothing happened".
   */
  replacementSecret: string;
}

/** Runner primitives + the world factory the shared suite needs. */
export interface IAuthServiceContractDeps {
  describe: (name: string, body: () => void) => void;
  it: (name: string, body: () => Promise<unknown>) => void;
  expect: ConformanceExpect;
  /** Fresh world per call — it must contain exactly what it describes. */
  makeContext: () => Promise<AuthServiceContractContext>;
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
  absentSessionId: SessionId;
}
