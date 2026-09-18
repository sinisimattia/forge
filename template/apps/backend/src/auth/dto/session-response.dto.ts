import type { SessionJSON } from '__FORGE_SCOPE__/core/auth/types';

/**
 * One of the actor's own sessions, as they are shown it.
 *
 * The whole of core's `Session` is safe to return, and structurally so: the
 * entity has no field a credential could live in, so no serialization of one can
 * leak a credential. That is what makes an "active sessions" screen possible
 * without a redaction step somebody would eventually forget to maintain.
 *
 * `isCurrent` is added here rather than in core, because which session is
 * current is a fact about the request being served and not about the session.
 */
export interface SessionResponseDto extends SessionJSON {
  /** Whether this is the session the request that asked was made through. */
  isCurrent: boolean;
}
