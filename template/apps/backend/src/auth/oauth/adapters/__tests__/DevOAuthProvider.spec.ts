import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { DEV_OAUTH_CODE_TTL_MS, DevOAuthProvider } from '../DevOAuthProvider';

const REDIRECT_URI = 'http://localhost:3000/auth/oauth/OIDC/callback';
/** The one address a `DevOAuthProvider` instance below is configured to assert. */
const CONFIGURED_ADDRESS = 'dev-signin@example.test';
/** A distinct address, used only to build a second instance configured differently. */
const OTHER_ADDRESS = 'ada@example.test';

/**
 * Mints a code the only way this suite is allowed to now: through
 * `authorizationUrl`, on a fresh instance configured for `address`.
 * `mintAuthorizationCode` is not part of this class's public surface — see
 * its own doc for why a total-bypass adapter should not expose "mint for
 * whatever address you like" beyond what a real sign-in ever needs.
 */
async function mintCode(address: string): Promise<{ adapter: DevOAuthProvider; code: string }> {
  const adapter = new DevOAuthProvider(address);
  const url = new URL(await adapter.authorizationUrl({
    state: 's', codeChallenge: 'c', redirectUri: REDIRECT_URI,
  }));
  return { adapter, code: url.searchParams.get('code') as string };
}

describe('DevOAuthProvider', () => {
  // Restored here, not at the end of each test that mocks it: a failing
  // assertion inside a test skips whatever cleanup came after it, so a
  // `mockRestore()` placed after the assertion leaves `Date.now` frozen for
  // every later test in the file — one real failure becoming a cascade of
  // misleading ones.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authorizationUrl — no page, a direct round trip', () => {
    // An earlier shape of this adapter pointed authorizationUrl at
    // `GET /auth/oauth/dev/authorize`, a page that was never built and that
    // 404'd — exactly ADR-0008's forbidden "button that fails when someone
    // presses it." There is no page: authorizationUrl mints the code itself
    // and hands back the real callback URL carrying it, so pressing the
    // button lands directly back in `OAuthService.complete`.

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

  it('is the only adapter whose account assertion needs no network', () => {
    // Not decoration: this is the property that makes it the development adapter.
    // If this class ever gains a fetch, it has stopped being one.
    expect(DevOAuthProvider.prototype.fetchAccount.toString()).not.toMatch(/fetch\(/);
  });

  // The seam an earlier pass of this adapter left open: `mintAuthorizationCode`
  // had no expiry and no single-use enforcement, safe only because nothing
  // called it. Load-bearing now, not merely prudent: `authorizationUrl` calls
  // it on every real sign-in through this adapter (see the describe block
  // above).
  describe('closes the mintAuthorizationCode seam', () => {
    it('refuses a code once it has expired', async () => {
      const mintedAt = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(mintedAt);
      const { adapter, code } = await mintCode(CONFIGURED_ADDRESS);

      // Exactly at expiry, the code must already be refused — `exp` is a
      // deadline, not a still-good instant, so `<=` is the comparison this
      // test pins.
      jest.spyOn(Date, 'now').mockReturnValue(mintedAt + DEV_OAUTH_CODE_TTL_MS);

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).rejects.toThrow();
    });

    it('accepts the same code the instant before it expires', async () => {
      // The direction the case above cannot prove on its own: a check that
      // refuses everything would also pass "refuses once expired."
      const mintedAt = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(mintedAt);
      const { adapter, code } = await mintCode(CONFIGURED_ADDRESS);

      jest.spyOn(Date, 'now').mockReturnValue(mintedAt + DEV_OAUTH_CODE_TTL_MS - 1);

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).resolves.toMatchObject({ subject: CONFIGURED_ADDRESS });
    });

    it('refuses a code presented a second time, on the instance that minted it', async () => {
      const { adapter, code } = await mintCode(CONFIGURED_ADDRESS);

      await expect(
        adapter.fetchAccount({ code, codeVerifier: 'v', redirectUri: REDIRECT_URI }),
      ).resolves.toMatchObject({ subject: CONFIGURED_ADDRESS });

      // The exact same code, presented again. A caller who captured it off
      // the first redirect must not be able to replay it.
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
      // actually verified against this instance's own secret. A different
      // configured address too, so a pass here cannot be mistaken for an
      // address check succeeding by coincidence.
      const { code: codeFromAnotherInstance } = await mintCode(OTHER_ADDRESS);

      const adapter = new DevOAuthProvider(CONFIGURED_ADDRESS);
      await expect(
        adapter.fetchAccount({
          code: codeFromAnotherInstance, codeVerifier: 'v', redirectUri: REDIRECT_URI,
        }),
      ).rejects.toThrow();
    });
  });
});
