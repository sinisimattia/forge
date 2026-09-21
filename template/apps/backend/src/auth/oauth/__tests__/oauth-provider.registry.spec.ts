import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { FederatedAccount } from '__FORGE_SCOPE__/core/identities/types';
import type { IOAuthProvider } from '../IOAuthProvider';
import { OAuthProviderRegistry } from '../oauth-provider.registry';

/** A fake adapter carrying nothing but the one field `find` reads. */
function fakeProvider(provider: AuthProvider): IOAuthProvider {
  return {
    provider,
    authorizationUrl: () => { throw new Error('not called in this suite'); },
    fetchAccount: (): Promise<FederatedAccount> => { throw new Error('not called in this suite'); },
  };
}

describe('OAuthProviderRegistry', () => {
  // This deployment registered Google alone — GitHub and the development
  // provider are real `AuthProvider` members, but this registry never built an
  // adapter for either.
  const registry = new OAuthProviderRegistry([fakeProvider(AuthProvider.GOOGLE)]);

  it('lists what it was given as available', () => {
    expect(registry.available).toEqual([AuthProvider.GOOGLE]);
  });

  it('resolves a name this deployment registered', () => {
    expect(registry.find('GOOGLE')?.provider).toBe(AuthProvider.GOOGLE);
  });

  it('answers null for a real AuthProvider member this deployment did not register', () => {
    expect(registry.find('GITHUB')).toBeNull();
  });

  it('answers null for PASSWORD, which is never a federated provider', () => {
    expect(registry.find('PASSWORD')).toBeNull();
  });

  it.each(['', '__proto__', 'google'])('answers null for %j', (name) => {
    expect(registry.find(name)).toBeNull();
  });
});
