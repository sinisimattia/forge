import type { UserId } from '../../users/types/UserId';
import type { Session } from '../entities/Session';
import type { AuthenticationAttempt } from '../types/AuthenticationAttempt';
import type { AuthenticationOutcome } from '../types/AuthenticationOutcome';
import type { RegisterInput } from '../types/RegisterInput';
import type { SessionId } from '../types/SessionId';

/**
 * Coming into being, proving who you are, and ending the sessions that proves.
 *
 * Every method that acts on somebody's own record takes `actorId` — the user on
 * whose behalf the call is made — as its first parameter. Nothing is resolved
 * from ambient state: an implementation that decided for itself who was calling
 * would be impossible to reason about and impossible to test (ADR-0007).
 *
 * **Renewing a session is not on this contract, and its absence is the design.**
 * Rotating a session needs the credential the caller presented, which one
 * implementation of this interface is structurally unable to read. A method
 * both implementations must have would force that one to pretend it had
 * something it does not, and a contract whose conformance suite can only be
 * satisfied by pretending has stopped being a contract. Renewal therefore
 * belongs to the implementation that holds the credential, reached directly,
 * and is held to its own suite there.
 *
 * Three methods resolve whether or not the address they were given is known —
 * {@link IAuthService.register}, {@link IAuthService.resendVerification} and
 * {@link IAuthService.requestPasswordReset}. That is one rule, applied three
 * times: any of them that answered differently for a known address would let
 * anyone test an address for existence, one call at a time, and registration is
 * the easiest of the three to probe.
 */
export interface IAuthService {
  /**
   * Begins registration. Always resolves, whether or not the address is already
   * in use — a distinguishable failure here is the same enumeration oracle that
   * signing in and password recovery are careful to avoid, and registration is
   * the easiest of the three to probe. What the person receives at the address
   * tells them which of the two happened; a stranger learns nothing.
   *
   * The policy judgement is not part of that silence, and is made first: how
   * long a secret has to be is a published rule of the deployment, so refusing
   * a secret that breaks it reveals nothing about any address.
   *
   * @param input - the address, display name and secret the person supplied
   * @throws WeakPasswordError when the secret does not meet the policy
   */
  register(input: RegisterInput): Promise<void>;

  /**
   * Consumes a verification token, proving the address it was sent to.
   *
   * Single-use and expiring, and the two failures are told apart deliberately:
   * only somebody who held a real token can reach either.
   *
   * @param token - the single-use value delivered to the address
   * @throws ConsumedTokenError when that token has already been used
   * @throws ExpiredTokenError when its lifetime has run out — and when no token
   * answers to it at all, which is the same answer on purpose
   */
  verifyEmail(token: string): Promise<void>;

  /**
   * Re-issues verification. Always resolves, for the same reason as
   * {@link IAuthService.register}.
   *
   * @param email - the address to send to, as the person typed it
   */
  resendVerification(email: string): Promise<void>;

  /**
   * Attempts authentication.
   *
   * Never throws for a failed attempt — failure is an outcome, because failing
   * to sign in is an ordinary thing to do and an exception would make every
   * caller treat it as a fault. What comes back is a discriminated union, so a
   * caller cannot read a user off it without having established that there is
   * one (see {@link AuthenticationOutcome}).
   *
   * @param attempt - the address, the secret, and what could be told about the client
   * @returns who was proven and the session that now exists, or the reason it failed
   */
  authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome>;

  /**
   * Begins password recovery. Always resolves, whether or not the address is
   * known, for the same reason as {@link IAuthService.register}.
   *
   * @param email - the address to send to, as the person typed it
   */
  requestPasswordReset(email: string): Promise<void>;

  /**
   * Consumes a reset token and replaces the secret.
   *
   * Ends every session the user holds. Recovery is what somebody does when they
   * have lost control of the account, so leaving a session alive would leave
   * whoever took it exactly where they were.
   *
   * @param token - the single-use value delivered to the address
   * @param newSecret - the replacement secret
   * @throws ConsumedTokenError when that token has already been used
   * @throws ExpiredTokenError when its lifetime has run out, or no token answers to it
   * @throws WeakPasswordError when the replacement does not meet the policy
   */
  resetPassword(token: string, newSecret: string): Promise<void>;

  /**
   * Replaces the actor's own secret, proving the current one first.
   *
   * Ends every other session the user holds: the commonest reason to change a
   * secret is that somebody else may know it, and the change is worth little if
   * whoever knew it stays signed in.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param currentSecret - the secret they hold now, as proof it is them
   * @param newSecret - the replacement secret
   * @throws InvalidCredentialsError when the current secret is not theirs
   * @throws WeakPasswordError when the replacement does not meet the policy
   */
  changePassword(actorId: UserId, currentSecret: string, newSecret: string): Promise<void>;

  /**
   * The actor's own sessions, newest first. There is no path to another user's.
   *
   * Only the ones still usable: a session that has been ended, or has run out,
   * is not something its owner can act on, and listing it would ask them to
   * decide about something already decided.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns every usable session the actor holds, newest first, as entities
   */
  listSessions(actorId: UserId): Promise<Session[]>;

  /**
   * Ends one of the actor's own sessions.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param sessionId - the session to end
   * @throws SessionNotFoundError when it is not theirs — indistinguishable from
   * not existing, so the call cannot be used to probe for other people's ids
   */
  revokeSession(actorId: UserId, sessionId: SessionId): Promise<void>;

  /**
   * Ends every session the actor holds, including the one they are using.
   *
   * @param actorId - the user on whose behalf the call is made
   */
  revokeAllSessions(actorId: UserId): Promise<void>;
}
