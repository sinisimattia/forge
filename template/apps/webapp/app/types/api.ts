import type { SessionJSON } from '__FORGE_SCOPE__/core/auth/types';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';

/**
 * The vocabulary of the wire, kept here because it is the wire's and not the
 * domain's.
 *
 * None of it may move into `libs/core`. A status code, a cookie, a bearer
 * credential and an error envelope are facts about how two processes talk, and
 * core is written so that it does not know there are two (ADR-0008). What crosses
 * in the other direction — `UserJSON`, `SessionJSON`, `AuthIdentityJSON` — is
 * core's, and is imported rather than restated.
 */

/** The four verbs this API is reached with. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * A machine-readable name for a refusal the domain expressed.
 *
 * **It exists because the status code is not enough, and that was measured
 * rather than supposed.** The backend answers both `ConsumedTokenError` and
 * `ExpiredTokenError` with `410 Gone` — deliberately, so that telling them apart
 * reveals nothing to a guesser — and the only other thing that distinguished
 * them was `message`, which is translated prose. A webapp that switched on prose
 * would break in the second locale; a webapp that could not switch at all cannot
 * satisfy `IAuthService.verifyEmail`, which names both errors.
 *
 * The same reasoning covers `404`, which three different core errors reach, and
 * `401`, which means "your credential is not accepted" for the guard and "the
 * secret you offered is not yours" for a password change.
 *
 * **This list is a second copy of the backend's table** (`DOMAIN_ERROR_CODES` in
 * `apps/backend/src/common/filters/http-exception.filter.ts`), and there is
 * nowhere shared to put it: it is transport vocabulary, so it may not live in
 * core, and the two apps share nothing else. A code the backend emits and this
 * list does not name arrives here as `undefined` and falls through to the
 * envelope's status, which is the safe direction to be wrong in.
 *
 * **Nothing else can catch the two copies drifting apart**, which is why it is a
 * value rather than a bare union and why a test pins it to a literal list. The
 * stub the conformance suites run against emits the very strings these services
 * switch on, so the webapp stays internally consistent while becoming externally
 * wrong: renaming `TOKEN_CONSUMED` here and in both files that use it left the
 * whole webapp suite green while the backend went on emitting the old name. The
 * literal list in `types/__tests__/api-error-code.spec.ts` — and its twin on the
 * backend — is what turns that red, in one place or the other, so that whoever
 * renames one is sent to the other.
 */
export const API_ERROR_CODES = [
  'DISPLAY_NAME_REQUIRED',
  'EMAIL_ALREADY_REGISTERED',
  'IDENTITY_ALREADY_LINKED',
  'IDENTITY_NOT_FOUND',
  'INVALID_CREDENTIALS',
  'LAST_IDENTITY_REMOVAL',
  'SESSION_NOT_FOUND',
  'TOKEN_CONSUMED',
  'TOKEN_EXPIRED',
  'USER_NOT_FOUND',
  'WEAK_PASSWORD',
] as const;

/** One of the names {@link API_ERROR_CODES} lists. */
export type ApiErrorCode = typeof API_ERROR_CODES[number];

/** One field-level complaint about a request body. */
export interface ApiErrorDetail {
  /** The offending field, dotted for a nested one. */
  field: string;
  /** Already translated by the server; safe to show. */
  message: string;
}

/**
 * One reason a password was refused.
 *
 * `code` is core's own union, which is why the webapp can render every reason
 * exhaustively and why a member added to it becomes a compile error here rather
 * than an unrendered string.
 */
export interface ApiErrorViolation {
  /** Core's `PasswordPolicyViolation` member. */
  code: PasswordPolicyViolation;
  /** The same reason in prose, already translated. */
  message: string;
}

/**
 * The body the backend's global exception filter emits for every refusal.
 *
 * `error` is the canonical HTTP reason phrase, `message` is translated prose for
 * a person, and neither is something to branch on — {@link ApiErrorCode} is.
 */
export interface ApiErrorBody {
  /** The canonical HTTP reason phrase for the status. */
  error: string;
  /** Translated prose for whoever is looking at the screen. */
  message: string;
  /** Present when the refusal came from the domain. */
  code?: ApiErrorCode;
  /** Present when a request body failed validation. */
  details?: ApiErrorDetail[];
  /** Present when a password was refused. */
  violations?: ApiErrorViolation[];
}

/**
 * One request, as a fetcher describes it.
 *
 * It describes *what is wanted*, not how it travels: no headers, no URL, no
 * cookie handling. Those belong to whichever {@link ApiClient} is serving, which
 * is what lets the conformance suites drive the real services against a stub of
 * the backend without either the services or the fetchers knowing.
 */
export interface ApiRequest {
  readonly method: HttpMethod;
  /**
   * The path below the API base, e.g. `/auth/login`.
   *
   * The fetchers are the only place in the webapp where one of these is spelled.
   */
  readonly path: string;
  /** The JSON body, if the verb carries one. */
  readonly body?: unknown;
  /** Query parameters, already in their final form. */
  readonly query?: Readonly<Record<string, string | number>>;
  /**
   * The user on whose behalf the call is made, as the contract names them
   * (ADR-0007).
   *
   * **A transport is free to ignore it**, and the real one does: a browser holds
   * one credential, so `createApiClient` presents that one and the server
   * resolves the actor from it. It is carried anyway because the core contracts
   * take `actorId` explicitly and a transport that can serve several actors at
   * once — the one the conformance suites run against — needs to be told which.
   */
  readonly actor?: UserId;
  /**
   * A credential to present for this one request, instead of whatever the
   * transport holds.
   *
   * Exactly one caller needs it, and its need is real: `AuthHttpService`
   * authenticates, is handed a credential, and must then read back the session
   * that sign-in opened — before the caller it will hand the credential to has
   * had any chance to store it.
   */
  readonly credential?: string;
  /**
   * Whether the browser's renewal cookie travels with this request.
   *
   * True on every auth-path request and false everywhere else. Without it the
   * cookie the backend sets on sign-in never comes back, and renewal silently
   * stops working the first time the access credential lapses (DEC-3).
   */
  readonly withCookie?: boolean;
}

/**
 * The transport a fetcher issues its request through.
 *
 * It resolves with the parsed body, or with `undefined` for a `204`. It rejects
 * with an `ApiError` for every non-2xx answer, so a fetcher contains no status
 * handling at all and a service has exactly one kind of failure to map.
 */
export type ApiClient = <T>(request: ApiRequest) => Promise<T>;

/**
 * What a successful sign-in, renewal or password change answers with.
 *
 * The backend's `AuthResponseDto`, restated here because the two apps share no
 * package that a transport shape could live in — `libs/core` is where the domain
 * lives and a credential is not part of it.
 *
 * The renewal credential is **not** in this body: it is a cookie the browser
 * will not let script read. The access credential is, because it has to be
 * attached to requests by this application's own code and there is nowhere else
 * to put it that the code could read (DEC-3).
 */
export interface AuthResponseBody {
  /** Who was proven, in the shape core's `User.toJSON` defines. */
  user: UserJSON;
  /** The credential to present on ordinary requests. */
  accessToken: string;
  /** How long it lasts, in seconds. */
  expiresIn: number;
}

/**
 * The credential a sign-in or a password change issued, on its way out of
 * `AuthHttpService` to whoever will hold it.
 *
 * It exists so that DEC-3 has a shape rather than a convention. The core
 * `AuthenticationOutcome` carries a user and a session and nothing else; the
 * credential that arrived beside them in the same response leaves through a
 * webapp-only method, in this type, which core has never heard of and must never
 * hear of.
 */
export interface IssuedCredential {
  /** The credential to present on ordinary requests. */
  accessToken: string;
  /** How long it lasts, in seconds, so a holder can renew before it lapses. */
  expiresIn: number;
}

/**
 * One of the actor's own sessions as the backend renders it: core's wire shape,
 * plus the one fact that is about the request rather than about the session.
 */
export interface SessionResponseBody extends SessionJSON {
  /** Whether this is the session the asking request was made through. */
  isCurrent: boolean;
}
