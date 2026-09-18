import { PlatformRole } from '../enums/PlatformRole';
import { UserStatus } from '../enums/UserStatus';
import type { UserId } from '../types/UserId';
import type { UserJSON } from '../types/UserJSON';

/**
 * Build a valid {@link UserJSON} wire object, overriding any fields.
 *
 * The default is an ordinary account that can authenticate — active, verified,
 * not deleted — because that is the state most tests need before they change
 * exactly one thing about it.
 *
 * @param overrides - fields to replace on the default
 * @returns a complete wire object
 */
export function makeUserJSON(overrides: Partial<UserJSON> = {}): UserJSON {
  return {
    id: 'user-1' as UserId,
    email: 'ada@example.com',
    displayName: 'Ada',
    status: UserStatus.ACTIVE,
    platformRole: PlatformRole.PLATFORM_USER,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}
