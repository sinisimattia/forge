import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { ClientContext, SessionId, SessionJSON } from '__FORGE_SCOPE__/core/auth/types';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import {
  assertAtLeastOneIdentityRemains,
  DEFAULT_PASSWORD_POLICY,
  evaluatePassword,
} from '__FORGE_SCOPE__/core/identities/policies';
import {
  IdentityNotFoundError,
  LastIdentityRemovalError,
} from '__FORGE_SCOPE__/core/identities/errors';
import type { AuthIdentityId, AuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/types';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';
import { User } from '__FORGE_SCOPE__/core/users/entities';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { DisplayNameRequiredError } from '__FORGE_SCOPE__/core/users/errors';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { ApiError } from '~/fetchers';
import type { ApiClient, ApiErrorBody, ApiErrorCode, ApiRequest, SessionResponseBody } from '~/types';

/**
 * A model of the backend, at the wire.
 *
 * This stub is a model of the backend, not the backend. It proves that the
 * webapp's services parse what the backend produces and map errors as the
 * contract requires. It proves nothing about whether the backend behaves
 * correctly — that is the backend's own conformance run and the end-to-end
 * walk. When the two disagree, the stub is what is wrong.
 *
 * That paragraph is the difference between DEC-1 being a design and DEC-1 being
 * a comment nobody read, so it is worth saying what it rules out in particular.
 * Nothing below is evidence that the backend answers `410` for a spent
 * verification credential, that its guard answers `404` rather than `403`, or
 * that a session is really revoked in its database. Every one of those is
 * asserted on the other side, against the real implementation, by the same core
 * suites. What is asserted here is the half no backend test can reach: that
 * given those answers, these services build the entities and raise the errors
 * the contracts name.
 *
 * ## One thing it models that the real wire cannot carry
 *
 * `ApiRequest.client` — what the implementation can tell about the client an
 * attempt came from. A browser can tell nothing and a real transport drops it;
 * this stub reads it, because a stub stands in for the network as well as for
 * the server. **So the shared suite's assertion that a client context reaches
 * the session is, on this side, a statement about this file.** It is written
 * down rather than quietly relied on: the same assertion against the real pair
 * is the backend's conformance run, where the client context is observed rather
 * than supplied.
 *
 * ## Why the world is seeded as JSON and promised from the same literals
 *
 * Every `put*` below takes the wire shape and stores what the *entity* makes of
 * it — `User.fromJSON(seed).toJSON()` — because that is exactly what the backend
 * emits: a controller returns `entity.toJSON()`, never a stored row. A driver
 * then promises the world by building the entity from **its own literal**, not
 * by reading this stub back. That is the difference between an assertion and a
 * tautology: a stub that dropped a field on write would otherwise have the same
 * gap on both sides of every comparison and agree with itself.
 */

/** Nothing is known about the client, which is what most requests here say. */
const NO_CLIENT: ClientContext = { address: null, label: null };

/** How long a session the stub opens lasts. A week, as the backend's does. */
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** How long an access credential lasts, in seconds, as the backend reports it. */
const ACCESS_LIFETIME_SECONDS = 900;

/** What the backend's filter puts in `error` for the statuses this stub answers. */
const REASON_PHRASE: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
};

/** A user as this stub holds one: the wire shape the backend would emit, and the secret. */
interface StoredUser {
  json: UserJSON;
  secret: string;
}

/** A single-use credential the stub issued. */
interface StoredCredential {
  userId: UserId;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** The world, plus the transport that serves it. */
export interface StubBackend {
  /**
   * The transport to build services on.
   *
   * **One per `stubBackend()` call, and the world behind it survives every
   * request made through it.** Building a fresh stub per request instead is the
   * mistake that makes a round-trip assertion fail as though the service were
   * wrong: the write lands in one world and the read happens in another.
   */
  readonly client: ApiClient;
  /** Puts a user in the world, exactly as the backend would hold and emit one. */
  putUser: (seed: UserJSON, secret: string) => void;
  /** Puts a session in the world. */
  putSession: (seed: SessionJSON) => void;
  /** Puts an identity in the world. */
  putIdentity: (seed: AuthIdentityJSON) => void;
  /** Issues a verification credential, valid until `expiresAt`. */
  putVerification: (userId: UserId, credential: string, expiresAt: Date) => void;
}

/** The reason phrase the backend's filter derives from a status. */
function reasonPhrase(status: number): string {
  return REASON_PHRASE[status] ?? 'Error';
}

/** Refuses the request the way the backend's global exception filter would. */
function refuse(status: number, message: string, code?: ApiErrorCode): never {
  const body: ApiErrorBody = {
    error: reasonPhrase(status),
    message,
    ...(code === undefined ? {} : { code }),
  };
  throw new ApiError(status, body);
}

/** The refusal every failed attempt gets, whatever the real reason was. */
function refuseCredentials(): never {
  // One answer for every reason there is — no account, wrong secret, unverified,
  // suspended, deleted. The backend has the reason in scope and deliberately does
  // not read it; a stub that leaked it here would let a service be written that
  // depends on something the real wire never says.
  refuse(401, 'errors.auth.invalid_credentials', 'INVALID_CREDENTIALS');
}

/** Refuses a secret the deployment's policy will not accept, as the backend does. */
function assertAcceptableSecret(secret: string): void {
  const violations = evaluatePassword(secret, DEFAULT_PASSWORD_POLICY);
  if (violations.length === 0) return;
  throw new ApiError(422, {
    error: reasonPhrase(422),
    message: 'errors.auth.weak_password',
    code: 'WEAK_PASSWORD',
    // Every way it fell short, because that is what the backend sends and what
    // `WeakPasswordError` is built from on the other side.
    violations: violations.map((code) => ({ code, message: `errors.auth.password.${code}` })),
  });
}

/**
 * Builds a fresh world with nothing in it, and the transport that serves it.
 *
 * @returns the stub, whose `client` is the transport to build services on
 */
export function stubBackend(): StubBackend {
  const users = new Map<UserId, StoredUser>();
  const sessions = new Map<SessionId, SessionJSON>();
  const identities = new Map<AuthIdentityId, AuthIdentityJSON>();
  const verifications = new Map<string, StoredCredential>();
  const resets = new Map<string, StoredCredential>();
  /** Which session an access credential stands for. */
  const credentials = new Map<string, SessionId>();

  let sequence = 0;
  /** The next id of a kind, in this store's own format. */
  const nextId = (kind: string): string => {
    sequence += 1;
    return `stub-${kind}-${String(sequence)}`;
  };

  /**
   * An id of a kind that nothing already answers to.
   *
   * The loop is not defensive programming. A driver seeds the world through
   * `put*` with ids in this same format, and a counter that started at zero
   * regardless minted `stub-Session-1` for the first sign-in — **overwriting the
   * session the world had promised**. The suite reported "the world's session and
   * the fresh one, and nothing else: expected 1 to be 2", which reads as the
   * service losing a session and was this store silently reusing a key.
   *
   * @param kind - the sort of thing being identified
   * @param taken - whether this store already holds that id
   * @returns an id nothing answers to
   */
  const mint = (kind: string, taken: (id: string) => boolean): string => {
    let id = nextId(kind);
    while (taken(id)) id = nextId(kind);
    return id;
  };

  const userByEmail = (email: string): StoredUser | undefined => {
    const normalized = normalizeEmail(email);
    return [...users.values()].find((one) => one.json.email === normalized);
  };

  /** Whether the account may be used at all, decided by core and not restated. */
  const usable = (stored: StoredUser): boolean => User.fromJSON(stored.json).canAuthenticate();

  const activeSessionsOf = (userId: UserId): SessionJSON[] => {
    const now = new Date();
    return [...sessions.values()]
      .filter((one) => one.userId === userId && Session.fromJSON(one).isActive(now))
      // Newest first, and by id when two share an instant — the order the
      // backend's own session list promises.
      .sort((a, b) => (a.createdAt === b.createdAt
        ? String(b.id).localeCompare(String(a.id))
        : b.createdAt.localeCompare(a.createdAt)));
  };

  /** Opens a session and issues the credential that stands for it. */
  const beginSession = (userId: UserId, client: ClientContext): {
    session: SessionJSON;
    credential: string;
  } => {
    const now = new Date();
    const session: SessionJSON = {
      id: mint('Session', (id) => sessions.has(id as SessionId)) as SessionId,
      userId,
      createdAt: now.toISOString(),
      lastUsedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
      revokedAt: null,
      clientAddress: client.address,
      clientLabel: client.label,
    };
    sessions.set(session.id, session);
    const credential = nextId('credential');
    credentials.set(credential, session.id);
    return { session, credential };
  };

  /** Ends every session the user holds, as recovery and a password change do. */
  const revokeAllOf = (userId: UserId): void => {
    const now = new Date().toISOString();
    for (const [id, session] of sessions) {
      if (session.userId === userId && session.revokedAt === null) {
        sessions.set(id, { ...session, revokedAt: now });
      }
    }
  };

  /** Spends a single-use credential, answering the way the backend's filter does. */
  const spend = (store: Map<string, StoredCredential>, value: string): UserId => {
    const held = store.get(value);
    // A credential nobody ever issued is reported as expired, **not** as
    // unknown, and that is the backend's rule rather than a shortcut: an answer
    // that distinguished them would tell a guesser which of their guesses had
    // once been real.
    if (held === undefined) refuse(410, 'errors.auth.token_expired', 'TOKEN_EXPIRED');
    if (held.consumedAt !== null) refuse(410, 'errors.auth.token_consumed', 'TOKEN_CONSUMED');
    if (held.expiresAt.getTime() <= Date.now()) {
      refuse(410, 'errors.auth.token_expired', 'TOKEN_EXPIRED');
    }
    store.set(value, { ...held, consumedAt: new Date() });
    return held.userId;
  };

  /**
   * Who the request is being made by, and through which session.
   *
   * A credential is preferred because that is the only thing a real request
   * carries. `actor` is the test transport's own affordance: the conformance
   * suites drive one service instance as several people, which no browser does
   * and no credential can express. See `ApiRequest.actor`.
   */
  const actorOf = (request: ApiRequest): { userId: UserId; sessionId: SessionId | null } => {
    if (request.credential !== undefined) {
      const sessionId = credentials.get(request.credential);
      const session = sessionId === undefined ? undefined : sessions.get(sessionId);
      if (session === undefined) refuse(401, 'errors.http.unauthorized');
      return { userId: session.userId, sessionId: session.id };
    }
    if (request.actor !== undefined) return { userId: request.actor, sessionId: null };
    refuse(401, 'errors.http.unauthorized');
  };

  /** Whether the actor operates the deployment, which is what the admin guard asks. */
  const isAdmin = (userId: UserId): boolean =>
    users.get(userId)?.json.platformRole === PlatformRole.PLATFORM_ADMIN;

  /**
   * The user a platform-administration route was asked about.
   *
   * Everything a non-administrator asks for here is `404` — not `403` — and with
   * the same body a missing user gets, because the guard is written so that "you
   * may not" and "there is no such thing" are indistinguishable.
   */
  const adminTarget = (actorId: UserId, targetId: UserId): StoredUser => {
    if (!isAdmin(actorId)) refuse(404, 'errors.http.not_found');
    const stored = users.get(targetId);
    if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
    return stored;
  };

  /** Replaces a user, keeping the wire shape the backend would emit. */
  const save = (user: User, secret: string): UserJSON => {
    const json = user.toJSON();
    users.set(json.id, { json, secret });
    return json;
  };

  const body = <T>(request: ApiRequest): T => request.body as T;

  /** One `/auth` request. */
  const auth = (request: ApiRequest, tail: string): unknown => {
    const { method } = request;

    if (method === 'POST' && tail === '/register') {
      const input = body<{ email: string; displayName: string; secret: string }>(request);
      // The policy judgement is made first and out loud, before the address is
      // looked at: how long a secret has to be is a published rule, so refusing
      // one that breaks it reveals nothing about any address.
      assertAcceptableSecret(input.secret);
      if (userByEmail(input.email) === undefined) {
        const now = new Date();
        const user = new User({
          id: mint('User', (id) => users.has(id as UserId)) as UserId,
          email: input.email,
          displayName: input.displayName,
          status: UserStatus.ACTIVE,
          platformRole: PlatformRole.PLATFORM_USER,
          emailVerifiedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        save(user, input.secret);
        const identity = new AuthIdentity({
          id: mint(
            'AuthIdentity',
            (id) => identities.has(id as AuthIdentityId),
          ) as AuthIdentityId,
          userId: user.id,
          provider: AuthProvider.PASSWORD,
          providerAccountId: input.email,
          createdAt: now,
          lastUsedAt: null,
        });
        identities.set(identity.id, identity.toJSON());
        verifications.set(nextId('verification'), {
          userId: user.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          consumedAt: null,
        });
      }
      // **No branch reaches the response.** Whether an account was created or
      // one already existed is the difference this endpoint exists not to tell.
      return { status: 'accepted' };
    }

    if (method === 'POST' && tail === '/verify-email') {
      const userId = spend(verifications, body<{ credential: string }>(request).credential);
      const stored = users.get(userId);
      if (stored !== undefined) {
        const user = User.fromJSON(stored.json);
        const now = new Date();
        save(new User({ ...user, emailVerifiedAt: now, updatedAt: now }), stored.secret);
      }
      return { status: 'verified' };
    }

    if (method === 'POST' && tail === '/resend-verification') {
      const stored = userByEmail(body<{ email: string }>(request).email);
      if (stored !== undefined && stored.json.emailVerifiedAt === null) {
        verifications.set(nextId('verification'), {
          userId: stored.json.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          consumedAt: null,
        });
      }
      return { status: 'accepted' };
    }

    if (method === 'POST' && tail === '/login') {
      const attempt = body<{ email: string; secret: string }>(request);
      const stored = userByEmail(attempt.email);
      if (stored === undefined || stored.secret !== attempt.secret || !usable(stored)) {
        refuseCredentials();
      }
      const opened = beginSession(stored.json.id, request.client ?? NO_CLIENT);
      return {
        user: stored.json,
        accessToken: opened.credential,
        expiresIn: ACCESS_LIFETIME_SECONDS,
      };
    }

    if (method === 'POST' && tail === '/forgot-password') {
      const stored = userByEmail(body<{ email: string }>(request).email);
      if (stored !== undefined) {
        resets.set(nextId('reset'), {
          userId: stored.json.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          consumedAt: null,
        });
      }
      return { status: 'accepted' };
    }

    if (method === 'POST' && tail === '/reset-password') {
      const input = body<{ credential: string; secret: string }>(request);
      assertAcceptableSecret(input.secret);
      const userId = spend(resets, input.credential);
      const stored = users.get(userId);
      if (stored !== undefined) {
        users.set(userId, { ...stored, secret: input.secret });
        revokeAllOf(userId);
      }
      return { status: 'reset' };
    }

    if (method === 'POST' && tail === '/change-password') {
      const { userId } = actorOf(request);
      const input = body<{ currentSecret: string; newSecret: string }>(request);
      const stored = users.get(userId);
      if (stored === undefined || stored.secret !== input.currentSecret) {
        refuse(401, 'errors.auth.invalid_credentials', 'INVALID_CREDENTIALS');
      }
      assertAcceptableSecret(input.newSecret);
      users.set(userId, { ...stored, secret: input.newSecret });
      // Every session ends, the caller's included — and then one is opened for
      // the caller this request is serving, which is what the transport can do
      // and the domain cannot.
      revokeAllOf(userId);
      const opened = beginSession(userId, request.client ?? NO_CLIENT);
      return {
        user: stored.json,
        accessToken: opened.credential,
        expiresIn: ACCESS_LIFETIME_SECONDS,
      };
    }

    if (method === 'POST' && tail === '/logout') {
      const { sessionId } = actorOf(request);
      if (sessionId !== null) {
        const session = sessions.get(sessionId);
        if (session !== undefined) {
          sessions.set(sessionId, { ...session, revokedAt: new Date().toISOString() });
        }
      }
      return undefined;
    }

    if (method === 'GET' && tail === '/sessions') {
      const actor = actorOf(request);
      const listed: SessionResponseBody[] = activeSessionsOf(actor.userId)
        .map((session) => ({ ...session, isCurrent: session.id === actor.sessionId }));
      return listed;
    }

    const revoking = /^\/sessions\/(.+)$/.exec(tail);
    if (method === 'DELETE' && revoking !== null) {
      const actor = actorOf(request);
      const target = sessions.get(revoking[1] as SessionId);
      // Another person's session and one that does not exist are the same answer.
      // Anything else is a way to discover which ids are real by trying them.
      if (target === undefined || target.userId !== actor.userId) {
        refuse(404, 'errors.auth.session_not_found', 'SESSION_NOT_FOUND');
      }
      sessions.set(target.id, { ...target, revokedAt: new Date().toISOString() });
      return undefined;
    }

    refuse(405, 'errors.http.bad_request');
  };

  /** One `/users/me/identities` request. */
  const identityRoutes = (request: ApiRequest, tail: string): unknown => {
    const actor = actorOf(request);
    const held = [...identities.values()]
      .filter((one) => one.userId === actor.userId)
      .map((one) => AuthIdentity.fromJSON(one));

    if (request.method === 'GET' && tail === '') return held.map((one) => one.toJSON());

    const unlinking = /^\/(.+)$/.exec(tail);
    if (request.method === 'DELETE' && unlinking !== null) {
      const identityId = unlinking[1] as AuthIdentityId;
      try {
        // Core's own policy, called rather than restated — the same one the
        // backend calls. A count query here would be a second copy of a rule,
        // and a stub whose rule had drifted from the domain's would report the
        // webapp's mapping as wrong when it was the stub that was.
        assertAtLeastOneIdentityRemains(held, identityId);
      } catch (error) {
        if (error instanceof IdentityNotFoundError) {
          refuse(404, 'errors.http.not_found', 'IDENTITY_NOT_FOUND');
        }
        if (error instanceof LastIdentityRemovalError) {
          refuse(409, 'errors.http.conflict', 'LAST_IDENTITY_REMOVAL');
        }
        throw error;
      }
      identities.delete(identityId);
      return undefined;
    }

    refuse(405, 'errors.http.bad_request');
  };

  /** One `/users` request. */
  const userRoutes = (request: ApiRequest, tail: string): unknown => {
    if (tail.startsWith('/me/identities')) {
      return identityRoutes(request, tail.slice('/me/identities'.length));
    }

    const actor = actorOf(request);
    const { method } = request;

    if (method === 'GET' && tail === '/me') {
      const stored = users.get(actor.userId);
      if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
      return stored.json;
    }

    if (method === 'PATCH' && tail === '/me') {
      const stored = users.get(actor.userId);
      if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
      const changes = body<{ displayName?: string }>(request);
      const current = User.fromJSON(stored.json);
      try {
        return save(
          new User({
            ...current,
            ...(changes.displayName === undefined ? {} : { displayName: changes.displayName }),
            updatedAt: new Date(),
          }),
          stored.secret,
        );
      } catch (error) {
        // The one domain refusal `PATCH /users/me` can raise, and caught by its
        // own type rather than by a bare `catch` — a bare one would report a
        // programming mistake in this file as a blank display name, and the
        // webapp would then map an internal fault to a perfectly plausible
        // domain error. It carries a code rather than leaving the caller to
        // infer it from "a 422 on this path".
        if (error instanceof DisplayNameRequiredError) {
          refuse(422, 'errors.http.unprocessable', 'DISPLAY_NAME_REQUIRED');
        }
        throw error;
      }
    }

    if (method === 'DELETE' && tail === '/me') {
      const stored = users.get(actor.userId);
      if (stored === undefined) refuse(404, 'errors.http.not_found', 'USER_NOT_FOUND');
      const now = new Date();
      // Soft, so that history referencing the account stays readable.
      save(
        new User({ ...User.fromJSON(stored.json), deletedAt: now, updatedAt: now }),
        stored.secret,
      );
      revokeAllOf(actor.userId);
      return undefined;
    }

    if (method === 'GET' && tail === '') {
      if (!isAdmin(actor.userId)) refuse(404, 'errors.http.not_found');
      const page = Number(request.query?.page ?? 1);
      const limit = Number(request.query?.limit ?? 20);
      const all = [...users.values()].map((one) => one.json);
      return {
        data: all.slice((page - 1) * limit, page * limit),
        meta: { total: all.length, page, limit, totalPages: Math.ceil(all.length / limit) },
      };
    }

    const status = /^\/([^/]+)\/status$/.exec(tail);
    if (method === 'PATCH' && status !== null) {
      const target = adminTarget(actor.userId, status[1] as UserId);
      return save(
        new User({
          ...User.fromJSON(target.json),
          status: body<{ status: UserStatus }>(request).status,
          updatedAt: new Date(),
        }),
        target.secret,
      );
    }

    const role = /^\/([^/]+)\/platform-role$/.exec(tail);
    if (method === 'PATCH' && role !== null) {
      const target = adminTarget(actor.userId, role[1] as UserId);
      return save(
        new User({
          ...User.fromJSON(target.json),
          platformRole: body<{ platformRole: PlatformRole }>(request).platformRole,
          updatedAt: new Date(),
        }),
        target.secret,
      );
    }

    const byId = /^\/([^/]+)$/.exec(tail);
    if (method === 'GET' && byId !== null) {
      return adminTarget(actor.userId, byId[1] as UserId).json;
    }

    refuse(405, 'errors.http.bad_request');
  };

  // `async` with nothing awaited, on purpose: the real transport is async and a
  // service that happened to work only against a synchronous one would be a
  // service nothing had tested. Every refusal below therefore arrives as a
  // rejected promise, exactly as `createApiClient`'s does.
  const client: ApiClient = async <T>(request: ApiRequest): Promise<T> => {
    await Promise.resolve();
    if (request.path.startsWith('/auth')) {
      return auth(request, request.path.slice('/auth'.length)) as T;
    }
    if (request.path.startsWith('/users')) {
      return userRoutes(request, request.path.slice('/users'.length)) as T;
    }
    refuse(404, 'errors.http.not_found');
  };

  return {
    client,

    putUser(seed: UserJSON, secret: string): void {
      // Stored as the *entity* renders it, because that is what the backend
      // emits: a controller returns `entity.toJSON()` and never a stored row. A
      // seed whose address is not in normal form therefore arrives normalized,
      // exactly as it would from the real one.
      users.set(seed.id, { json: User.fromJSON(seed).toJSON(), secret });
    },

    putSession(seed: SessionJSON): void {
      sessions.set(seed.id, Session.fromJSON(seed).toJSON());
    },

    putIdentity(seed: AuthIdentityJSON): void {
      identities.set(seed.id, AuthIdentity.fromJSON(seed).toJSON());
    },

    putVerification(userId: UserId, credential: string, expiresAt: Date): void {
      verifications.set(credential, { userId, expiresAt, consumedAt: null });
    },
  };
}
