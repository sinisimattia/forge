import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import { makeUserJSON } from '__FORGE_SCOPE__/core/users/testing';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

describe('makeUserJSON', () => {
  it('defaults to an account that can authenticate, which is what most tests start from', () => {
    const json = makeUserJSON();
    expect(json.status).toBe(UserStatus.ACTIVE);
    expect(json.platformRole).toBe(PlatformRole.PLATFORM_USER);
    expect(json.emailVerifiedAt).not.toBeNull();
    expect(json.deletedAt).toBeNull();
  });

  it('defaults to an address already in normal form', () => {
    expect(makeUserJSON().email).toBe(makeUserJSON().email.trim().toLowerCase());
  });

  it('lets an override win over the default', () => {
    const json = makeUserJSON({ id: 'user-9' as UserId, displayName: 'Grace', deletedAt: null });
    expect(json.id).toBe('user-9');
    expect(json.displayName).toBe('Grace');
    expect(json.email).toBe('ada@example.com');
  });
});
