import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionId, SessionJSON } from '__FORGE_SCOPE__/core/auth/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { ApiError } from '~/fetchers';
import type { ApiClient, AuthResponseBody, SessionResponseBody } from '~/types';
import type { StubBackend } from './stubBackend';
import { stubBackend } from './stubBackend';

/**
 * What this stub claims about `POST /auth/refresh`, written down so that somebody
 * has to come and change it.
 *
 * ## Why this file exists
 *
 * `stubBackend` grew a model of renewal — a cookie, rotation, single-use
 * credentials and reuse detection — because the store's concurrency assertion
 * needs the *symptom* and not only a request count. That model is a claim about
 * the backend, and until this file there was nothing that made it one: the webapp
 * suite would stay green while the stub and the backend drifted, exactly as it
 * did when the stub answered a sign-in refusal with `code: 'INVALID_CREDENTIALS'`
 * and the real one answered with no code at all. That was found by accident. So
 * was the second one: the reuse branch here used to end **every session the user
 * held**, where the backend ends one.
 *
 * This is the same shape `types/__tests__/api-error-code.spec.ts` uses one level
 * down: a literal list of propositions in two places, so that whoever changes one
 * is sent to the other.
 *
 * ## The three propositions, and where their other half lives
 *
 * 1. **A request that presents no renewal credential is refused `401`, with no
 *    `code`.** Backend: `auth.controller.ts`'s `refreshSession` throws a bare
 *    `new UnauthorizedException()` before it does anything else, and the global
 *    filter's `HttpException` branch never assigns `code`.
 * 2. **A valid credential is exchanged: `200`, a user, a fresh access credential,
 *    and a renewal credential *different from the one presented*.** Backend:
 *    `RefreshTokenService.rotate` spends the presented row and issues a successor,
 *    and the controller sets the new cookie. Rotation, not reissue, is the whole
 *    reason a second presentation is detectable.
 * 3. **A spent credential is refused `401`, and the session it belonged to is
 *    dead afterwards — that session, and not the user's others.** Backend:
 *    `RefreshTokenService.rotate` answers reuse with
 *    `SessionService.endSession(manager, row.sessionId, now)`, which revokes that
 *    session's row and marks that session's unspent credentials used; pinned by
 *    `apps/backend/src/auth/__tests__/refresh-rotation.spec.ts` (D8) — *revokes
 *    the session* and *revokes every other renewal credential in that session*.
 *    Nothing there touches another session.
 *
 * **When the two disagree, this stub is what is wrong.** These assertions are not
 * evidence about the backend; the backend's own half is. What they are is a
 * tripwire on the model the webapp's other specs are driven against.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const ACTOR_ID = 'stub-User-1' as UserId;

const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

/**
 * A second session the actor already holds, seeded directly.
 *
 * It is the whole of proposition 3's second clause: the other device. A stub that
 * ended every session of the user's on reuse leaves this one revoked, and a stub
 * at the backend's scope leaves it alone.
 */
const OTHER_DEVICE_ID = 'stub-Session-other' as SessionId;

const OTHER_DEVICE: SessionJSON = {
  id: OTHER_DEVICE_ID,
  userId: ACTOR_ID,
  createdAt: SEEDED_AT,
  lastUsedAt: SEEDED_AT,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  revokedAt: null,
  clientAddress: null,
  clientLabel: null,
};

describe('stubBackend — POST /auth/refresh, cross-checked against the backend', () => {
  let backend: StubBackend;
  let client: ApiClient;

  /** One renewal, exactly as `postRefresh` issues one. */
  const refresh = (): Promise<AuthResponseBody> =>
    client<AuthResponseBody>({ method: 'POST', path: '/auth/refresh', withCookie: true });

  /** Whatever the refresh rejected with, or a failure if it did not reject. */
  const refusalOf = async (attempt: Promise<unknown>): Promise<ApiError> => {
    try {
      await attempt;
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      return error as ApiError;
    }
    throw new Error('the renewal was expected to be refused and was not');
  };

  /** Signs the actor in, which is the only thing that mints a renewal credential. */
  const signIn = async (): Promise<void> => {
    await client<AuthResponseBody>({
      method: 'POST',
      path: '/auth/login',
      body: { email: ACTOR.email, secret: PLAINTEXT },
      withCookie: true,
    });
  };

  beforeEach(() => {
    backend = stubBackend();
    client = backend.client;
    backend.putUser(ACTOR, PLAINTEXT);
    backend.putSession(OTHER_DEVICE);
  });

  // Proposition 1.
  it('refuses a renewal that presents nothing, with no code', async () => {
    expect(backend.renewalCookie()).toBeNull();

    const refusal = await refusalOf(refresh());

    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBeUndefined();
  });

  // Proposition 1, the other way it happens: a request that did not ask for the
  // cookie to travel. `postRefresh` sets `withCookie`; a version that stopped
  // setting it fails here rather than in production.
  it('refuses a renewal that did not ask for the cookie to travel', async () => {
    await signIn();

    const refusal = await refusalOf(
      client<AuthResponseBody>({ method: 'POST', path: '/auth/refresh' }),
    );

    expect(refusal.status).toBe(401);
  });

  // Proposition 2.
  it('exchanges a valid credential for a different one', async () => {
    await signIn();
    const presented = backend.renewalCookie();
    const mintedBySignIn = backend.issuedCredentials();

    const body = await refresh();

    expect(body.user.id).toBe(ACTOR_ID);
    expect(presented).not.toBeNull();
    // Rotation, not reissue. If the same value came back, a second presentation
    // would be indistinguishable from a first and proposition 3 could not exist.
    expect(backend.renewalCookie()).not.toBe(presented);
    expect(backend.renewalCookie()).not.toBeNull();
    // A fresh access credential too, and not the sign-in's.
    expect(backend.issuedCredentials().length).toBe(mintedBySignIn.length + 1);
    expect(body.accessToken).not.toBe(mintedBySignIn[mintedBySignIn.length - 1]);
  });

  // Proposition 3, first clause.
  it('refuses a credential that has already been spent', async () => {
    await signIn();
    const presented = backend.renewalCookie();
    await refresh();
    // Put the spent one back in the browser's hand, which is what a raced
    // renewal, or a copy somebody else took, really does.
    backend.presentRenewalCookie(presented);

    const refusal = await refusalOf(refresh());

    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBeUndefined();
  });

  /**
   * Proposition 3, second clause — **the one that catches the divergence**.
   *
   * The reused credential's own session is dead and the actor's other session is
   * untouched. A stub that revoked every session of the user's passes the first
   * assertion and fails the second, which is what it did before this file existed.
   */
  it('ends the reused credential\'s session, and only that one', async () => {
    await signIn();
    const presented = backend.renewalCookie();
    await refresh();
    backend.presentRenewalCookie(presented);

    await refusalOf(refresh());

    const live = await client<SessionResponseBody[]>({
      method: 'GET',
      path: '/auth/sessions',
      actor: ACTOR_ID,
      withCookie: true,
    });
    // `GET /auth/sessions` lists only the usable ones, so this is both clauses at
    // once: the reused credential's session is gone and the other device is not.
    expect(live.map((one) => String(one.id))).toEqual([String(OTHER_DEVICE_ID)]);
  });
});
