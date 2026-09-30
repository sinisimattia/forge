import type { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import type { AuthenticationOutcome } from '__FORGE_SCOPE__/core/auth/types';
import type { MfaChallengeMethodBody } from './api';

/**
 * Shapes a screen needs that neither the domain nor the wire supplies on its own.
 *
 * They live here rather than beside a component for the reason `STANDARDS.md`
 * gives: a type crossing more than one module is a named type in `app/types/`,
 * so a composable and the organism it feeds cannot describe the same value two
 * slightly different ways.
 */

/**
 * One of the actor's own sessions, together with the one fact about it that is
 * not a fact about it.
 *
 * `Session` is core's entity and carries no `isCurrent`, deliberately: whether a
 * session is "the current one" is a property of *the request that asked*, not of
 * the session, and the same session is current for one request and not for the
 * next. Core therefore cannot model it and `IAuthService.listSessions` cannot
 * return it.
 *
 * A screen still needs it — "you are using this one" is the difference between a
 * revoke button that ends somebody else's session and one that signs the person
 * out mid-click — and the **only** honest source is the server, which is the only
 * party that can see which session served the request. It is read at the moment
 * the list is fetched and is not stored, because it is true only of that read.
 */
export interface OwnSession {
  /** The session itself, as core's entity. */
  readonly session: Session;
  /** Whether the request that fetched this list was made through this session. */
  readonly isCurrent: boolean;
}

/**
 * A sign-in that proved a password and is owed a second factor, as this
 * application can say it.
 *
 * Core's `MFA_REQUIRED` outcome carries a `User` and full `MfaMethod`s, because
 * the backend has both in hand when it decides. The browser has neither: the
 * body it is answered with names no user (it has proven nothing but a password)
 * and describes each method in three fields. Building a core outcome from that
 * would mean inventing a `User`, so this application does not — it has its own
 * arm, carrying what the wire carried.
 *
 * **`challengeToken` is here only on its way to the store.** It is what makes
 * this value a bearer of something, and {@link LoginOutcome} is the same shape
 * with it taken off.
 */
export interface ChallengedSignIn {
  /** Discriminant: credentials were proven; a second factor is owed. */
  readonly status: AuthenticationStatus.MFA_REQUIRED;
  /** What to present at `POST /auth/mfa/verify`. Single-use, minutes-long. */
  readonly challengeToken: string;
  /** The second factors this person may finish with. */
  readonly methods: readonly MfaChallengeMethodBody[];
}

/**
 * What `AuthHttpService.beginSignIn` reports: core's outcomes for the two ends
 * that core can describe, and {@link ChallengedSignIn} for the one it cannot.
 */
export type SignInResult
  = | Exclude<AuthenticationOutcome, { status: AuthenticationStatus.MFA_REQUIRED }>
    | ChallengedSignIn;

/**
 * What a component learns from signing in: {@link SignInResult}, with the
 * challenge token taken off.
 *
 * The token stays in the auth store's memory. A component that needs to present
 * it does so by asking the store to, so that no component ever holds a
 * credential it could put in a URL, a log line or a rendered attribute.
 */
export type LoginOutcome
  = | Exclude<SignInResult, ChallengedSignIn>
    | Omit<ChallengedSignIn, 'challengeToken'>;
