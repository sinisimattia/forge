import type { IAuthService } from '__FORGE_SCOPE__/core/auth/contracts';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import { AuthenticationRejectionReason, AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import {
  ConsumedTokenError,
  ExpiredTokenError,
  InvalidCredentialsError,
  SessionNotFoundError,
} from '__FORGE_SCOPE__/core/auth/errors';
import type {
  AuthenticationAttempt,
  AuthenticationOutcome,
  RegisterInput,
  SessionId,
} from '__FORGE_SCOPE__/core/auth/types';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import {
  ApiError,
  deleteSession,
  getSessions,
  postChangePassword,
  postForgotPassword,
  postLogin,
  postRegister,
  postResendVerification,
  postResetPassword,
  postVerifyEmail,
} from '~/fetchers';
import type { ApiClient, AuthResponseBody, IssuedCredential, OwnSession } from '~/types';

/**
 * The error the contract names for a refusal that arrived as an envelope.
 *
 * It reads the backend's `code` first — falling back to the status only for a
 * `404`, for the reason `UserHttpService` gives — and this service is the
 * clearest case for why a code is needed at all. `ConsumedTokenError` and `ExpiredTokenError` are
 * **both** `410 Gone` — deliberately, because only somebody who held a real
 * credential can reach either, so telling them apart reveals nothing to a
 * guesser — and the contract's `verifyEmail` names both. Without a machine-
 * readable code there is no way for this side to honour that, and the only other
 * thing distinguishing the two answers is `message`, which is translated prose.
 *
 * @param error - whatever the fetcher threw
 * @param subject - the id the caller asked about, for the error's own message
 * @returns the error to throw
 */
function domainErrorFor(error: unknown, subject: string): unknown {
  if (!(error instanceof ApiError)) return error;
  switch (error.body.code) {
    case 'TOKEN_CONSUMED':
      return new ConsumedTokenError();
    case 'TOKEN_EXPIRED':
      return new ExpiredTokenError();
    case 'INVALID_CREDENTIALS':
      return new InvalidCredentialsError();
    case 'SESSION_NOT_FOUND':
      return new SessionNotFoundError(subject);
    case 'WEAK_PASSWORD':
      // The list, not a summary of it: `WeakPasswordError` carries every way the
      // secret fell short because that is what a caller shows the person, and an
      // implementation that collapsed them would make this webapp tell somebody
      // one thing to fix at a time. An envelope with no `violations` yields an
      // empty list rather than an invented one — saying nothing is better than
      // naming a rule the server did not.
      return new WeakPasswordError((error.body.violations ?? []).map((one) => one.code));
    default:
      // A refusal with no code the webapp recognises. A `404` on these paths is
      // still a session nobody may see — it is what the guard answers as well as
      // what the domain error answers, and telling them apart is exactly what
      // that 404 is designed to prevent. Anything else is returned untouched.
      return error.status === 404 ? new SessionNotFoundError(subject) : error;
  }
}

/**
 * Implements the core contract over the wire.
 *
 * Two responsibilities, and no others: turn a response into the entity the
 * contract promises, and turn a failure into the error the contract names. A
 * caller of this service cannot tell it from the other implementation, which is
 * what the shared conformance suite exists to keep true.
 *
 * ## The one place the two worlds touch
 *
 * `POST /auth/login` answers with the core-shaped user **and an access
 * credential beside it**. The credential is taken out here and leaves through
 * {@link AuthHttpService.takeIssuedCredential}, a method that exists on this
 * class and on no contract. What `authenticate` returns is exactly an
 * `AuthenticationOutcome`, and core never learns a credential existed.
 *
 * Returning it inside the outcome would be one line shorter and would put
 * transport vocabulary into a core type — where `libs/core`'s purity gate cannot
 * see it, because the leak would be on this side of the boundary. The discipline
 * is therefore this class's, which is why it is written down here rather than
 * assumed.
 *
 * ## Renewal is deliberately absent
 *
 * There is no `refresh` method, because there is none on the contract and there
 * must not be: rotating a session needs the credential the caller presented, and
 * the backend's implementation of this same interface cannot read it. Renewal is
 * `postRefresh` in the fetchers, which the store calls directly.
 */
export class AuthHttpService implements IAuthService {
  private readonly client: ApiClient;

  /**
   * The credential the last sign-in or password change issued, until somebody
   * takes it.
   *
   * Private and takeable rather than readable, so that a credential is handed
   * over once and is not left on the service for anything else to find.
   */
  private issued: IssuedCredential | null = null;

  /** @param client - the transport the fetchers issue through */
  public constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * The credential issued by the most recent `authenticate` or `changePassword`,
   * removing it from this service.
   *
   * **Webapp-only, and on no contract.** It is the other half of the seam: the
   * response carried a credential beside the outcome, the outcome is core's and
   * may not carry one, and this is where the credential goes instead. The caller
   * is the store, which puts it where `createApiClient` will read it.
   *
   * @returns the credential, or `null` if there is none to take
   */
  public takeIssuedCredential(): IssuedCredential | null {
    const taken = this.issued;
    this.issued = null;
    return taken;
  }

  /** @inheritdoc */
  public async register(input: RegisterInput): Promise<void> {
    try {
      await postRegister(this.client, input);
    } catch (error) {
      throw domainErrorFor(error, input.email);
    }
  }

  /** @inheritdoc */
  public async verifyEmail(token: string): Promise<void> {
    try {
      await postVerifyEmail(this.client, token);
    } catch (error) {
      throw domainErrorFor(error, token);
    }
  }

  /** @inheritdoc */
  public async resendVerification(email: string): Promise<void> {
    try {
      await postResendVerification(this.client, email);
    } catch (error) {
      throw domainErrorFor(error, email);
    }
  }

  /**
   * @inheritdoc
   *
   * Two requests, and the second one is not a convenience. The contract promises
   * a `Session`, the sign-in response does not carry one, and the only other
   * place a session can come from is the list the server holds — read back with
   * the credential that sign-in just issued, which nothing else has yet been
   * given. Reading it back is also strictly better evidence than an echo would
   * be: what comes back is what the server *stored*, so an implementation that
   * accepted the client context and then dropped it is visible here rather than
   * reflected.
   */
  public async authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome> {
    let body: AuthResponseBody;
    try {
      // `attempt.client` is deliberately not sent. See `postLogin`: the server
      // observes what it can tell about the client, and this side cannot.
      body = await postLogin(this.client, { email: attempt.email, secret: attempt.secret });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return {
          status: AuthenticationStatus.REJECTED,
          // **The server refuses to say which reason applied, and that is its
          // design**: an answer that distinguished "no such account" from "wrong
          // secret" would let anybody test an address for existence one attempt
          // at a time. So this side does not know, and says so.
          //
          // It used to answer `INVALID_SECRET` — the first of the precedence
          // order — because the union had no way to express ignorance. That
          // value was always a lie, and a lie in a field the type calls
          // knowledge: a screen switching on it would tell somebody whose
          // account had been blocked that their password was wrong. `UNDISCLOSED`
          // exists so the type can say the true thing, and so that a consumer
          // that does branch has a member it must handle rather than a plausible
          // one it will not think to question.
          reason: AuthenticationRejectionReason.UNDISCLOSED,
        };
      }
      throw domainErrorFor(error, attempt.email);
    }

    const user = User.fromJSON(body.user);
    // DEC-3, in two statements. The credential is taken out of the response here
    // and parked for `takeIssuedCredential`; what is built below it carries no
    // trace of it.
    this.issued = { accessToken: body.accessToken, expiresIn: body.expiresIn };
    const session = await this.currentSession(user.id, body.accessToken);

    return { status: AuthenticationStatus.AUTHENTICATED, user, session };
  }

  /** @inheritdoc */
  public async requestPasswordReset(email: string): Promise<void> {
    try {
      await postForgotPassword(this.client, email);
    } catch (error) {
      throw domainErrorFor(error, email);
    }
  }

  /** @inheritdoc */
  public async resetPassword(token: string, newSecret: string): Promise<void> {
    try {
      await postResetPassword(this.client, token, newSecret);
    } catch (error) {
      throw domainErrorFor(error, token);
    }
  }

  /**
   * @inheritdoc
   *
   * The backend ends every session and opens a fresh one for the caller it is
   * serving, so this answers with a credential just as a sign-in does — and it
   * goes the same way, out through {@link AuthHttpService.takeIssuedCredential}.
   * The contract returns nothing, and a caller that forgets to take it is left
   * presenting a credential the server has just killed.
   */
  public async changePassword(
    actorId: UserId,
    currentSecret: string,
    newSecret: string,
  ): Promise<void> {
    try {
      const body = await postChangePassword(this.client, actorId, { currentSecret, newSecret });
      this.issued = { accessToken: body.accessToken, expiresIn: body.expiresIn };
    } catch (error) {
      throw domainErrorFor(error, String(actorId));
    }
  }

  /** @inheritdoc */
  public async listSessions(actorId: UserId): Promise<Session[]> {
    try {
      const listed = await getSessions(this.client, actorId);
      // `isCurrent` is dropped here and not carried onto the entity, because it
      // is a fact about the request that asked and not about the session: the
      // same session is current for one request and not for the next, so it is
      // not something `Session` could hold and stay true. A screen that needs it
      // asks {@link AuthHttpService.listOwnSessions} instead.
      //
      // It used to say a screen asks the store which session it is signed in as.
      // **The store cannot answer that**, and never could: it holds an access
      // credential, a user and a status, and `POST /auth/refresh` answers with
      // no session id at all — so after any full page load there is nothing in
      // this application that knows. That sentence was a claim about a capability
      // that does not exist, and a screen written to it would have shown no
      // current session to anybody who had reloaded the page.
      return listed.map((json) => Session.fromJSON(json));
    } catch (error) {
      throw domainErrorFor(error, String(actorId));
    }
  }

  /**
   * The actor's own sessions, each with whether this request was made through it.
   *
   * **Webapp-only, and on no contract**, for the same reason
   * {@link AuthHttpService.takeIssuedCredential} is: the response carries one
   * more fact than the contract's return type can hold, and the fact is a real
   * one a screen needs. Putting `isCurrent` on `Session` would be putting a
   * property of the asking request onto the thing asked about, and the backend's
   * implementation of this same interface — which serves many requests from one
   * store — could not produce it at all.
   *
   * It is a second request-shaped method rather than a flag on
   * {@link AuthHttpService.listSessions} so that the contract method keeps
   * exactly the signature the conformance suite drives.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns every usable session the actor holds, each paired with that flag
   */
  public async listOwnSessions(actorId: UserId): Promise<OwnSession[]> {
    try {
      const listed = await getSessions(this.client, actorId);
      return listed.map((json) => ({
        session: Session.fromJSON(json),
        isCurrent: json.isCurrent,
      }));
    } catch (error) {
      throw domainErrorFor(error, String(actorId));
    }
  }

  /** @inheritdoc */
  public async revokeSession(actorId: UserId, sessionId: SessionId): Promise<void> {
    try {
      await deleteSession(this.client, actorId, sessionId);
    } catch (error) {
      throw domainErrorFor(error, String(sessionId));
    }
  }

  /**
   * @inheritdoc
   *
   * **Composed, because the backend exposes no endpoint for it.** Every other
   * method here is one request; this one lists and then ends each, which is a
   * real difference and worth knowing: it is not atomic, so a session opened
   * between the list and the last delete survives. The contract's promise is
   * that the actor holds none afterwards, and the honest statement of what this
   * implementation gives is "none of the ones it could see".
   *
   * The alternative is a bulk endpoint on the other side, which is a decision
   * about the API rather than about this service.
   */
  public async revokeAllSessions(actorId: UserId): Promise<void> {
    const held = await this.listSessions(actorId);
    for (const session of held) {
      await this.revokeSession(actorId, session.id);
    }
  }

  /**
   * The session a just-completed sign-in opened.
   *
   * @param actorId - the user who was proven
   * @param credential - the credential that sign-in issued, which is the only
   * thing that can read this list before the caller has been handed it
   * @returns the session the server says the request was made through
   * @throws SessionNotFoundError when the server lists none as current, which
   * means the sign-in did not open one and there is nothing to return
   */
  private async currentSession(actorId: UserId, credential: string): Promise<Session> {
    const listed = await getSessions(this.client, actorId, credential);
    const current = listed.filter((one) => one.isCurrent)[0];
    if (current === undefined) throw new SessionNotFoundError(String(actorId));
    return Session.fromJSON(current);
  }
}
