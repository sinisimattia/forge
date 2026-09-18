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

  // Against the literal, not against a function of the value under test: the
  // latter holds for any address the fixture happens to return in normal form,
  // including an empty one, so it could not fail.
  it('defaults to an address already in normal form', () => {
    expect(makeUserJSON().email).toBe('ada@example.com');
  });

  it('lets an override win over the default', () => {
    const json = makeUserJSON({ id: 'user-9' as UserId, displayName: 'Grace', deletedAt: null });
    expect(json.id).toBe('user-9');
    expect(json.displayName).toBe('Grace');
    expect(json.email).toBe('ada@example.com');
  });
});
