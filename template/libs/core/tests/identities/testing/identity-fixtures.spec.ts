import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { makeAuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/testing';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';

describe('makeAuthIdentityJSON', () => {
  it('defaults to a password identity, which is the only one this phase implements', () => {
    expect(makeAuthIdentityJSON().provider).toBe(AuthProvider.PASSWORD);
  });

  it('defaults to an account identifier already in normal form', () => {
    expect(makeAuthIdentityJSON().providerAccountId).toBe('ada@example.com');
  });

  it('defaults to an identity that has never been used', () => {
    expect(makeAuthIdentityJSON().lastUsedAt).toBeNull();
  });

  it('lets an override win over the default', () => {
    const json = makeAuthIdentityJSON({
      id: 'identity-9' as AuthIdentityId,
      provider: AuthProvider.GITHUB,
    });
    expect(json.id).toBe('identity-9');
    expect(json.provider).toBe(AuthProvider.GITHUB);
    expect(json.providerAccountId).toBe('ada@example.com');
  });
});
