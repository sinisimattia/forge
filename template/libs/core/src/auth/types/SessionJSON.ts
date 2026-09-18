import type { UserId } from '../../users/types/UserId';
import type { SessionId } from './SessionId';

/**
 * The wire shape of a {@link Session}: the same eight facts, with every instant
 * as an ISO-8601 string, because a serialized payload has no `Date`.
 *
 * There is no field here for a credential, and there never will be. A session
 * is the *fact* that somebody is signed in; whatever they present to
 * demonstrate it is the business of whoever carries the demonstration, and a
 * field for it here would put it in every list of sessions the owner reads.
 */
export interface SessionJSON {
  /** The session's identifier. */
  id: SessionId;
  /** The person the session belongs to. */
  userId: UserId;
  /** When the session began. */
  createdAt: string;
  /** When it was last used. */
  lastUsedAt: string;
  /** When it ends of its own accord. */
  expiresAt: string;
  /** When it was ended early, or `null` if it was not. */
  revokedAt: string | null;
  /** The network address the session began from, or `null` if none was seen. */
  clientAddress: string | null;
  /** A short, opaque description of the client, or `null` if none was offered. */
  clientLabel: string | null;
}
