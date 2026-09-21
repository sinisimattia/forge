import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { DEV_OAUTH_CODE_TTL_MS, DevOAuthProvider } from '../DevOAuthProvider';

const REDIRECT_URI = 'http://localhost:3000/auth/oauth/OIDC/callback';
/** The one address a `DevOAuthProvider` instance below is configured to assert. */
const CONFIGURED_ADDRESS = 'dev-signin@example.test';
/** A distinct address used only where a test mints for an arbitrary subject. */
const ADDRESS = 'ada@example.test';

describe('DevOAuthProvider', () => {
  describe('authorizationUrl — no page, a direct round trip (Task 12 revision)', () => {
    // The first cut of this adapter pointed authorizationUrl at
    // `GET /auth/oauth/dev/authorize`, a page that was never built and that
    // 404'd — exactly ADR-0008's forbidden "button that fails when someone
    // presses it." The coordinator's ruling: no page at all. authorizationUrl
    // mints the code itself and hands back the real callback URL carrying it,
    // so pressing the button lands directly back in `OAuthService.complete`.

    it('returns the callback URL it was given, unmodified, as the base', async () => {
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);

      const url = await adapter.authorizationUrl({
        state: 'state-value',
        codeChallenge: 'challenge-value',
        redirectUri: REDIRECT_URI,
      });

      expect(new URL(url).origin + new URL(url).pathname).toBe(REDIRECT_URI);
    });

    it('carries the caller\'s own state, unchanged', async () => {
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);

      const url = new URL(await adapter.authorizationUrl({
        state: 'the-exact-state-value',
        codeChallenge: 'challenge-value',
        redirectUri: REDIRECT_URI,
      }));

      expect(url.searchParams.get('state')).toBe('the-exact-state-value');
    });

    it('carries a code that redeems for the configured address, through fetchAccount', async () => {
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);

      const url = new URL(await adapter.authorizationUrl({
        state: 'state-value',
        codeChallenge: 'challenge-value',
        redirectUri: REDIRECT_URI,
      }));
      const code = url.searchParams.get('code');
      expect(code).toEqual(expect.any(String));

      const account = await adapter.fetchAccount({
        code: code as string, codeVerifier: 'v', redirectUri: REDIRECT_URI,
      });

      expect(account).toEqual({
        provider: AuthProvider.OIDC,
        subject: CONFIGURED_ADDRESS,
        email: CONFIGURED_ADDRESS,
        emailVerified: true,
        displayName: null,
      });
    });

    it('mints a fresh code — and therefore a fresh URL — on every call', async () => {
      // No caching, no reuse: each press of the button is its own single-use
      // authorization, exactly as a real provider's own consent screen would
      // produce a new code each time.
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
      const params = { state: 's', codeChallenge: 'c', redirectUri: REDIRECT_URI };

      const first = new URL(await adapter.authorizationUrl(params)).searchParams.get('code');
      const second = new URL(await adapter.authorizationUrl(params)).searchParams.get('code');

      expect(first).not.toBe(second);
    });
  });

  it('asserts the address the code was minted for, as verified', async () => {
    const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
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
  // twice in the second (no set to consult). Load-bearing now, not merely
  // prudent: `authorizationUrl` calls `mintAuthorizationCode` on every real
  // sign-in through this adapter (see the describe block above).
  describe('closes the mintAuthorizationCode seam (Task 12)', () => {
    it('refuses a code once it has expired', async () => {
      const mintedAt = 1_700_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(mintedAt);
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
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
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
      const code = adapter.mintAuthorizationCode(ADDRESS);

      now.mockReturnValue(mintedAt + DEV_OAUTH_CODE_TTL_MS - 1);

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).resolves.toMatchObject({ subject: ADDRESS });

      now.mockRestore();
    });

    it('refuses a code presented a second time, on the instance that minted it', async () => {
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
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

    it('refuses a code minted through authorizationUrl if presented twice', async () => {
      // The end-to-end shape of the case above: the code a real sign-in
      // attempt actually redeems — minted by authorizationUrl itself, not by
      // a direct mintAuthorizationCode call — is exactly as single-use.
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
      const url = new URL(await adapter.authorizationUrl({
        state: 's', codeChallenge: 'c', redirectUri: REDIRECT_URI,
      }));
      const code = url.searchParams.get('code') as string;

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).resolves.toMatchObject({ subject: CONFIGURED_ADDRESS });

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).rejects.toThrow();
    });
  });

  describe('refuses a code it did not mint', () => {
    it('rejects a string with no signature at all', async () => {
      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);

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
      const minter = new DevOAuthProvider(CONFIGURED_ADDRESS);
      const codeFromAnotherInstance = minter.mintAuthorizationCode(ADDRESS);

      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
      await expect(
        adapter.fetchAccount({
          code: codeFromAnotherInstance, codeVerifier: 'v', redirectUri: REDIRECT_URI,
        }),
      ).rejects.toThrow();
    });
  });
});
