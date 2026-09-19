import type { Session } from '__FORGE_SCOPE__/core/auth/entities';

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
