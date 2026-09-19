import type { ClientContext, SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { ApiClient, AuthResponseBody, SessionResponseBody } from '~/types';

/**
 * The `/auth` endpoints, one function apiece.
 *
 * Each of them issues a request and returns the parsed body, and does nothing
 * else — no mapping, no error handling, no state. That is what makes this the
 * only file in the webapp where an auth path is spelled, and what makes the
 * service above it the only place where a response becomes a domain value.
 *
 * **Every function here asks for the cookie to travel**, which is the whole of
 * DEC-3 on this side. The backend sets the renewal credential as a cookie the
 * browser will not let script read; a request that does not ask for credentials
 * does not send it back, and renewal then fails the first time the access
 * credential lapses — in production, hours after anybody was looking. It is set
 * on every function rather than only on `postRefresh` so that there is no
 * judgement to get wrong when the next auth endpoint is added.
 */

/** Begins registration. Answers the same way whether or not the address is known. */
export async function postRegister(
  client: ApiClient,
  input: { email: string; displayName: string; secret: string },
): Promise<void> {
  await client<{ status: string }>({
    method: 'POST',
    path: '/auth/register',
    body: input,
    withCookie: true,
  });
}

/** Spends a verification credential. */
export async function postVerifyEmail(client: ApiClient, credential: string): Promise<void> {
  await client<{ status: string }>({
    method: 'POST',
    path: '/auth/verify-email',
    body: { credential },
    withCookie: true,
  });
}

/** Re-issues verification. Answers the same way whether or not the address is known. */
export async function postResendVerification(client: ApiClient, email: string): Promise<void> {
  await client<{ status: string }>({
    method: 'POST',
    path: '/auth/resend-verification',
    body: { email },
    withCookie: true,
  });
}

/**
 * Attempts authentication. Rejects with an `ApiError` for a failed attempt.
 *
 * `observed` is passed to the transport and **not** put in the body. The body is
 * whitelisted server-side, so an extra field there is a `400`; and the two things
 * a client context describes are the two things a client may not assert about
 * itself. See `ApiRequest.client` for the whole of that, including what it means
 * for the conformance suite.
 */
export async function postLogin(
  client: ApiClient,
  attempt: { email: string; secret: string },
  observed: ClientContext,
): Promise<AuthResponseBody> {
  return client<AuthResponseBody>({
    method: 'POST',
    path: '/auth/login',
    body: attempt,
    client: observed,
    withCookie: true,
  });
}

/**
 * Exchanges the renewal cookie for a fresh pair.
 *
 * It is a fetcher and not a service method because renewal is not on
 * `IAuthService` and must not be: rotating a session needs the credential the
 * caller presented, which the other implementation of that contract is
 * structurally unable to read. The store calls this directly.
 */
export async function postRefresh(client: ApiClient): Promise<AuthResponseBody> {
  return client<AuthResponseBody>({
    method: 'POST',
    path: '/auth/refresh',
    withCookie: true,
  });
}

/** Begins password recovery. Answers the same way whether or not the address is known. */
export async function postForgotPassword(client: ApiClient, email: string): Promise<void> {
  await client<{ status: string }>({
    method: 'POST',
    path: '/auth/forgot-password',
    body: { email },
    withCookie: true,
  });
}

/** Spends a recovery credential on a new secret. */
export async function postResetPassword(
  client: ApiClient,
  credential: string,
  secret: string,
): Promise<void> {
  await client<{ status: string }>({
    method: 'POST',
    path: '/auth/reset-password',
    body: { credential, secret },
    withCookie: true,
  });
}

/** Replaces the actor's own secret and re-issues their session. */
export async function postChangePassword(
  client: ApiClient,
  actor: UserId,
  secrets: { currentSecret: string; newSecret: string },
): Promise<AuthResponseBody> {
  return client<AuthResponseBody>({
    method: 'POST',
    path: '/auth/change-password',
    body: secrets,
    actor,
    withCookie: true,
  });
}

/** Ends the session the request was made through. */
export async function postLogout(client: ApiClient, actor: UserId): Promise<void> {
  await client<undefined>({ method: 'POST', path: '/auth/logout', actor, withCookie: true });
}

/**
 * The actor's own usable sessions, newest first.
 *
 * `credential` is optional and has exactly one caller: `AuthHttpService`
 * immediately after a sign-in, which holds a credential nothing else has been
 * given yet. See `ApiRequest.credential`.
 */
export async function getSessions(
  client: ApiClient,
  actor: UserId,
  credential?: string,
): Promise<SessionResponseBody[]> {
  return client<SessionResponseBody[]>({
    method: 'GET',
    path: '/auth/sessions',
    actor,
    withCookie: true,
    ...(credential === undefined ? {} : { credential }),
  });
}

/** Ends one of the actor's own sessions. */
export async function deleteSession(
  client: ApiClient,
  actor: UserId,
  sessionId: SessionId,
): Promise<void> {
  await client<undefined>({
    method: 'DELETE',
    path: `/auth/sessions/${String(sessionId)}`,
    actor,
    withCookie: true,
  });
}
