import type { UserId } from '../../users/types/UserId';
import type { SessionId } from './SessionId';

/**
 * Everything needed to construct a {@link Session}.
 *
 * A named object rather than positional parameters, for the reason
 * {@link UserProps} gives and more sharply: four of the eight fields are
 * instants and all four are adjacent, so a positional constructor makes a
 * silent transposition possible that no compiler can catch.
 */
export interface SessionProps {
  /** The session's identifier. */
  id: SessionId;
  /** The person the session belongs to. */
  userId: UserId;
  /** When the session began. */
  createdAt: Date;
  /** When it was last used. Never earlier than `createdAt`. */
  lastUsedAt: Date;
  /** When it ends of its own accord. Always later than `createdAt`. */
  expiresAt: Date;
  /** When it was ended early, or `null` if it ran or is running its course. */
  revokedAt: Date | null;
  /** The network address the session began from, as the implementation saw it. */
  clientAddress: string | null;
  /** A short, opaque description of the client, for the owner to recognize. */
  clientLabel: string | null;
}
