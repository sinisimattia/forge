import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { DEV_OAUTH_CODE_TTL_MS, DevOAuthProvider } from '../DevOAuthProvider';

const PUBLIC_API_URL = 'http://localhost:3000';
const REDIRECT_URI = 'http://localhost:3000/auth/oauth/callback';
const ADDRESS = 'ada@example.test';

describe('DevOAuthProvider', () => {
  it('asserts S256, never the RFC 7636 default of plain', async () => {
    // No `code_challenge_method` at all defaults to `plain` under RFC 7636 —
    // a challenge equal to its own verifier, the one method this phase
    // forbids offering. This adapter ignores PKCE (see the class's own doc),
    // so the omission cost nothing in practice; the URL it builds is still
    // what a generated project uses to rehearse the real flow, and it must
    // not declare the forbidden method.
    const adapter = new DevOAuthProvider(PUBLIC_API_URL);

    const url = new URL(await adapter.authorizationUrl({
      state: 'state-value',
      codeChallenge: 'challenge-value',
      redirectUri: REDIRECT_URI,
    }));

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

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

  // Task 12: the seam Task 6 left open — `mintAuthorizationCode` had no
  // expiry and no single-use enforcement, safe only because nothing called
  // it. These two cases are the covering proof for the fix, watched failing
  // against the pre-fix shape during development (a bare
  // `base64url(address) + '.' + signature`, no `exp`, no `consumed` set):
  // both cases below threw on `decoded.exp` being `undefined` in the first
  // case (no expiry to compare against) and both fetches simply succeeded
  // twice in the second (no set to consult).
  describe('closes the mintAuthorizationCode seam (Task 12)', () => {
    it('refuses a code once it has expired', async () => {
      const mintedAt = 1_700_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(mintedAt);
      const adapter = new DevOAuthProvider(PUBLIC_API_URL);
      const code = adapter.mintAuthorizationCode(ADDRESS);

      // Exactly at expiry, the code must already be refused — `exp` is a
      // deadline, not a still-good instant, so `<=` is the comparison this
      // test pins.
      now.mockReturnValue(mintedAt + DEV_OAUTH_CODE_TTL_MS);

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).rejects.toThrow();

      now.mockRestore();
    });

    it('accepts the same code the instant before it expires', async () => {
      // The direction the case above cannot prove on its own: a check that
      // refuses everything would also pass "refuses once expired."
      const mintedAt = 1_700_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(mintedAt);
      const adapter = new DevOAuthProvider(PUBLIC_API_URL);
      const code = adapter.mintAuthorizationCode(ADDRESS);

      now.mockReturnValue(mintedAt + DEV_OAUTH_CODE_TTL_MS - 1);

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).resolves.toMatchObject({ subject: ADDRESS });

      now.mockRestore();
    });

    it('refuses a code presented a second time, on the instance that minted it', async () => {
      const adapter = new DevOAuthProvider(PUBLIC_API_URL);
      const code = adapter.mintAuthorizationCode(ADDRESS);

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).resolves.toMatchObject({ subject: ADDRESS });

      // The exact same code, presented again. A caller who captured it off
      // the first redirect must not be able to replay it.
      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).rejects.toThrow();
    });
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
