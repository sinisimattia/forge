import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { DevOAuthProvider } from '../DevOAuthProvider';

const PUBLIC_API_URL = 'http://localhost:3000';
const REDIRECT_URI = 'http://localhost:3000/auth/oauth/callback';
const ADDRESS = 'ada@example.test';

describe('DevOAuthProvider', () => {
  it('asserts the address the code was minted for, as verified', async () => {
    const adapter = new DevOAuthProvider(PUBLIC_API_URL);
    const code = adapter.mintAuthorizationCode(ADDRESS);

    const account = await adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI });

    expect(account).toEqual({
      provider: AuthProvider.OIDC,
      subject: ADDRESS,
      email: ADDRESS,
      emailVerified: true,
      displayName: null,
    });
  });

  it('is the only adapter whose account assertion needs no network', () => {
    // Not decoration: this is the property that makes it the development adapter.
    // If this class ever gains a fetch, it has stopped being one.
    expect(DevOAuthProvider.prototype.fetchAccount.toString()).not.toMatch(/fetch\(/);
  });

  describe('refuses a code it did not mint', () => {
    it('rejects a string with no signature at all', async () => {
      const adapter = new DevOAuthProvider(PUBLIC_API_URL);

      await expect(
        adapter.fetchAccount({ code: 'not-mine', codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).rejects.toThrow();
    });

    it('rejects a well-formed code minted by a different instance', async () => {
      // The weaker fixture above ("not-mine") has no delimiter at all, so a
      // shallow implementation that only checks the code's shape — without
      // ever recomputing a signature — would pass it by accident. This one is
      // shaped exactly like a real code and fails only if the signature is
      // actually verified against this instance's own secret.
      const minter = new DevOAuthProvider(PUBLIC_API_URL);
      const codeFromAnotherInstance = minter.mintAuthorizationCode(ADDRESS);

      const adapter = new DevOAuthProvider(PUBLIC_API_URL);
      await expect(
        adapter.fetchAccount({
          code: codeFromAnotherInstance, codeVerifier: 'v', redirectUri: REDIRECT_URI,
        }),
      ).rejects.toThrow();
    });
  });
});
