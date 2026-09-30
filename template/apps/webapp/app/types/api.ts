import type { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import type { SessionJSON } from '__FORGE_SCOPE__/core/auth/types';
import type {
  PrincipalMembership,
  ResourceGrantJSON,
} from '__FORGE_SCOPE__/core/authorization/types';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';
import type { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { PlatformRole } from '__FORGE_SCOPE__/core/users/enums';
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
 * The same reasoning covers `404`, which several different core errors reach,
 * and `401`, which means "your credential is not accepted" for the guard and
 * "the secret you offered is not yours" for a password change.
 *
 * **This list is a hand-maintained snapshot of the backend's table**
 * (`DOMAIN_ERROR_CODES` in `apps/backend/src/common/filters/http-exception.filter.ts`),
 * plus `SERIALIZATION_CONFLICT` (below). There is nowhere shared to put the
 * real thing: it is transport vocabulary, so it may not live in core (ADR-0008),
 * and the two apps share no other package. A code the backend emits and this
 * list does not name arrives here as `undefined` and falls through to the
 * envelope's status, which is the safe direction to be wrong in.
 *
 * **What this list is, precisely, and what it does not claim:**
 *
 * - It is a *snapshot*, kept honest against *renaming* and nothing more. A
 *   literal-list test in `types/__tests__/api-error-code.spec.ts` — and its
 *   twin on the backend — pins both copies against the same literal, so that
 *   renaming a code in only one of the two files that share no package turns
 *   one or the other red. Neither test can catch the backend *adding* a code
 *   and this file staying silent: `DOMAIN_ERROR_CODES` is derived from the
 *   backend's own table and grows the moment a row is added there, while this
 *   array is typed out by hand and does not. That gap is exactly how this list
 *   fell eleven codes behind — the organization, membership, invitation and
 *   grant codes of Tasks 10–14 — with the literal-list test staying green on
 *   both sides throughout, because neither side's eleven-item literal ever
 *   had to change to stay equal to the other's eleven-item literal.
 * - It is **not** a completeness check against the backend, and it cannot be
 *   made into one without either importing backend code into this bundle
 *   (which would pull `@nestjs/common`, `express` and `nestjs-i18n` into a
 *   Nuxt app to read one array off a file that imports them at its top) or
 *   inventing a third package for eleven strings — the trade ADR-0008 already
 *   declined once for this exact vocabulary. So completeness stays a thing a
 *   person checks by reading both files side by side, same as it always has.
 * - What genuinely **is** checked, by the compiler rather than by a test: every
 *   code a service in this app *acts on* is a member of this list. Each
 *   service's own `domainErrorFor` switches on `error.body.code`, typed as
 *   `ApiErrorCode` — a union of the literals below — and a `case` naming a
 *   string outside that union fails to typecheck (`error TS2678`). A code can
 *   therefore be missing from this list and silently ignored (the safe
 *   direction), but never invented: nothing here can be switched on that this
 *   file does not already name. That is a real, narrower claim than
 *   completeness, and it is the one this file can actually stand behind.
 *
 * `SERIALIZATION_CONFLICT` is carried on this list for exactly this reason.
 * It is not one of `DOMAIN_ERROR_CODES` — the backend's filter emits it for a
 * retried `SERIALIZABLE` transaction conflict, which is not a `DomainError` at
 * all (see that filter's own comment) — but it is still a `code` the wire can
 * answer with, and a caller that ever needs to recognise "resend the same
 * request" has to be able to name it. No service in this webapp switches on
 * it yet; it is here so that the day one does, the compiler is already
 * holding the other end of that check.
 */
export const API_ERROR_CODES = [
  'ALREADY_A_MEMBER',
  'CROSS_TENANT_GRANT',
  'DISPLAY_NAME_REQUIRED',
  'EMAIL_ALREADY_REGISTERED',
  'GRANT_NOT_FOUND',
  'IDENTITY_ALREADY_LINKED',
  'IDENTITY_NOT_FOUND',
  'INVALID_CREDENTIALS',
  'INVALID_ORGANIZATION_SLUG',
  'INVITATION_ADDRESS_MISMATCH',
  'INVITATION_NO_LONGER_OPEN',
  'INVITATION_NOT_FOUND',
  'LAST_IDENTITY_REMOVAL',
  'LAST_OWNER',
  'MEMBERSHIP_NOT_FOUND',
  'MFA_LABEL_REQUIRED',
  'MFA_METHOD_ALREADY_CONFIRMED',
  'MFA_METHOD_NOT_FOUND',
  'MFA_REAUTHENTICATION_REQUIRED',
  'MFA_VERIFICATION_FAILED',
  'ORGANIZATION_NAME_REQUIRED',
  'ORGANIZATION_NOT_FOUND',
  'RECOVERY_CODE_ALREADY_CONSUMED',
  'SERIALIZATION_CONFLICT',
  'SESSION_NOT_FOUND',
  'TOKEN_CONSUMED',
  'TOKEN_EXPIRED',
  'USER_NOT_FOUND',
  'WEAK_PASSWORD',
] as const;

/** One of the names {@link API_ERROR_CODES} lists. */
export type ApiErrorCode = typeof API_ERROR_CODES[number];

/**
 * A machine-readable name for why a federated sign-in or link was refused.
 *
 * **A second hand-maintained snapshot, of a second table — not the same one
 * {@link API_ERROR_CODES} mirrors.** These seven never pass through
 * `HttpExceptionFilter` and never carry a `code` in a JSON body: they travel as
 * the `?error=` query parameter on the `302` `OAuthController.callback` sends
 * the browser back with, minted from the backend's own
 * `FederatedRefusalCode` (`apps/backend/src/auth/oauth/oauth.service.ts`). That
 * type's own TSDoc states the reason none of it may be a provider's error text:
 * it is attacker-influenced, and this application would be the one rendering it.
 *
 * Sorted with **`localeCompare`**, the same comparator {@link API_ERROR_CODES}
 * is sorted with and for the same reason: the same regression once passed
 * unnoticed on that list — the webapp's copy sorted with a bare `.sort()`,
 * which agrees with `localeCompare` on most pairs and not on every one, so
 * the check that was supposed to keep the two eyeball-comparable passed while
 * comparing an out-of-order copy to itself, because it used a different
 * comparator from the backend's own sort. `types/__tests__/federated-refusal-code.spec.ts`
 * pins both the literal and the comparator; read its own comment for what it
 * found when it went looking for a discriminating pair in this particular
 * seven — there is not one, which is itself worth knowing before trusting a
 * green run here more than it can support.
 *
 * No backend list is derived and exported for this one the way
 * `DOMAIN_ERROR_CODES` is: these codes are minted directly in
 * `OAuthController`, never routed through the exception filter's table, so
 * there is nothing on that side to pin against beyond the union's own literal.
 * The same completeness caveat `API_ERROR_CODES` states for itself therefore
 * applies here too, unweakened: an eighth code the backend starts minting and
 * this file never learns about is a silent gap, not a red test.
 */
export const FEDERATED_REFUSAL_CODES = [
  'ACCOUNT_UNAVAILABLE',
  'AUTHORIZATION_EXPIRED',
  'AUTHORIZATION_UNKNOWN',
  'EMAIL_ALREADY_REGISTERED',
  'EMAIL_UNVERIFIED',
  'IDENTITY_ALREADY_LINKED',
  'PROVIDER_UNAVAILABLE',
] as const;

/** One of the names {@link FEDERATED_REFUSAL_CODES} lists. */
export type FederatedRefusalCode = typeof FEDERATED_REFUSAL_CODES[number];

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
 * One second factor a person may finish a sign-in with, as `POST /auth/login`
 * describes it to somebody who has proven a password and nothing else.
 *
 * The backend's `MfaChallengeMethodDto`, restated for the reason
 * {@link AuthResponseBody} gives. Three fields and not core's `MfaMethodJSON`:
 * the account history that shape carries is not something this caller has been
 * shown, so there is nothing to render it from.
 */
export interface MfaChallengeMethodBody {
  /** What to send back as `methodId`. */
  id: string;
  /** Which kind of proof to produce. */
  type: MfaMethodType;
  /** The name the person gave it, so two of a kind can be told apart. */
  label: string;
}

/**
 * What `POST /auth/login` answers when the password was right and is not
 * enough: the backend's `MfaChallengeResponseDto`.
 *
 * **Nothing here opens anything.** No `accessToken`, no `user`, and no renewal
 * cookie behind it either. `challengeToken` proves only that the server saw a
 * correct password moments ago, and the one request that presents it spends it.
 */
export interface MfaChallengeResponseBody {
  /** The discriminant against {@link AuthResponseBody}. */
  status: AuthenticationStatus.MFA_REQUIRED;
  /** What to present at `POST /auth/mfa/verify`, once, within minutes. */
  challengeToken: string;
  /** The confirmed methods this account may finish the attempt with. */
  methods: MfaChallengeMethodBody[];
}

/**
 * Everything `POST /auth/login` can answer with on a `200`.
 *
 * **A union discriminated on `status`, and the success arm's `status` is
 * `undefined` rather than absent from the type.** The wire's success body has
 * no `status` (it is {@link AuthResponseBody}); writing that as
 * `status?: undefined` is what lets a check against `MFA_REQUIRED` narrow both
 * ways. A caller that reads `body.user` or `body.accessToken` without first
 * ruling the second arm out does not compile. When this was typed as
 * `AuthResponseBody` alone, a caller that never handled the challenge
 * compiled, ran, and read `undefined` out of a body that had no user in it.
 *
 * Only sign-in has a second arm. `POST /auth/refresh`, `/auth/change-password`
 * and `/auth/mfa/verify` answer `AuthResponseBody` and nothing else.
 */
export type LoginResponseBody
  = | (AuthResponseBody & { status?: undefined })
    | MfaChallengeResponseBody;

/**
 * The proof `POST /auth/mfa/verify` takes, beside the challenge: **a method and
 * the code it produced, or a recovery code — never both.**
 *
 * Two arms whose other fields are `?: never`, so a caller holding a `code` and
 * a `recoveryCode` at once cannot build one. The backend dispatches on which
 * fields are *present*, never on what a value looks like, and answers the same
 * `401` for a request that fits neither shape.
 */
export type MfaVerifyProof
  = | { methodId: string; code: string; recoveryCode?: never }
    | { recoveryCode: string; methodId?: never; code?: never };

/**
 * What `POST /mfa/webauthn/options` answers for a login: the ceremony's options
 * and the challenge token to present next.
 *
 * `publicKey` is `@simplewebauthn/browser`'s to interpret and is typed there;
 * it is `unknown` here so that this file, which every other file imports, does
 * not import a browser library.
 */
export interface WebAuthnOptionsResponseBody {
  /** The options to hand to `navigator.credentials.get`, in the library's JSON shape. */
  publicKey: unknown;
  /** The token to present at `POST /mfa/webauthn/verify`. The one presented to `options` is spent. */
  challengeToken: string | null;
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

/**
 * What `GET /users/me/principal` answers: the backend's `PrincipalResponseDto`,
 * restated here for the reason `AuthResponseBody` gives — the two apps share no
 * package a wire shape could live in.
 *
 * It exists so that `organization.ts`'s store can hydrate the exact `Principal`
 * `useCan` evaluates through core's `can()` (ADR-0006): a client predicts the
 * server's answer only if it is asking the same function the server asks, with
 * the same input, and this is that input's shape on the wire. `memberships`
 * needs no restating — it is already JSON-safe — but `grants` carries two
 * instants that arrive as ISO-8601 strings, because a serialized payload has no
 * `Date`; the store's own `toPrincipal` is where they are revived, mirroring
 * `AuthorizationHttpService`'s `toResourceGrant`.
 */
export interface PrincipalResponseBody {
  /** Whose principal this is. */
  userId: UserId;
  /** Their standing with respect to the deployment. */
  platformRole: PlatformRole;
  /** Every organization they belong to, and their role in each. */
  memberships: readonly PrincipalMembership[];
  /** The record-level exceptions they hold, live as of the instant this was served. */
  grants: readonly ResourceGrantJSON[];
}

/**
 * A proof of the second factor, in the body of a request that asks for one: a
 * method and the code it produced, **or** a recovery code, never both. The
 * backend's `MfaProofDto`; the same two-arm shape as {@link MfaVerifyProof}, and
 * for the same reason.
 */
export type MfaProofBody = MfaVerifyProof;

/**
 * What `POST /mfa/totp/enroll` answers: the backend's `TotpEnrollmentOffer`.
 *
 * **Shared-secret material, three ways** — inside `otpauthUri`, inside `qrSvg`,
 * and bare in `secret`. It is shown once and must be held by nothing longer-lived
 * than the panel showing it: no store, no `useState`, no storage.
 */
export interface TotpEnrollmentBody {
  methodId: string;
  otpauthUri: string;
  qrSvg: string;
  secret: string;
}

/** What `POST /mfa/totp/confirm` answers. `recoveryCodes` is the plaintext batch on the first confirmation, else `null`. */
export interface TotpConfirmationBody {
  recoveryCodes: string[] | null;
}

/** What `POST /mfa/recovery-codes` answers: the new batch, in the clear, once. */
export interface RecoveryCodesBody {
  recoveryCodes: string[];
}

/** What `POST /mfa/webauthn/verify` answers for an enrollment. */
export interface WebAuthnEnrollmentBody {
  method: MfaMethodJSON;
  recoveryCodes: string[] | null;
}
