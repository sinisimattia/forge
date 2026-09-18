import type { UserId } from '../../users/types/UserId';
import type { SessionId } from '../types/SessionId';
import type { SessionJSON } from '../types/SessionJSON';

/**
 * Build a valid {@link SessionJSON} wire object, overriding any fields.
 *
 * The default is an ordinary week-long session that began and was last used at
 * the same instant, has not been ended early, and was opened by a client
 * nothing is known about — because that is the state most tests need before
 * they change exactly one thing about it.
 *
 * @param overrides - fields to replace on the default
 * @returns a complete wire object
 */
export function makeSessionJSON(overrides: Partial<SessionJSON> = {}): SessionJSON {
  return {
    id: 'session-1' as SessionId,
    userId: 'user-1' as UserId,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-08T00:00:00.000Z',
    revokedAt: null,
    clientAddress: null,
    clientLabel: null,
    ...overrides,
  };
}
