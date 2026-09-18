import { AuthProvider } from '../enums/AuthProvider';
import type { AuthIdentityId } from '../types/AuthIdentityId';
import type { AuthIdentityJSON } from '../types/AuthIdentityJSON';
import type { UserId } from '../../users/types/UserId';

/**
 * Build a valid {@link AuthIdentityJSON} wire object, overriding any fields.
 *
 * The default is an ordinary password identity that has never been used,
 * because that is the state most tests need before they change exactly one
 * thing about it.
 *
 * @param overrides - fields to replace on the default
 * @returns a complete wire object
 */
export function makeAuthIdentityJSON(
  overrides: Partial<AuthIdentityJSON> = {},
): AuthIdentityJSON {
  return {
    id: 'identity-1' as AuthIdentityId,
    userId: 'user-1' as UserId,
    provider: AuthProvider.PASSWORD,
    providerAccountId: 'ada@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  };
}
