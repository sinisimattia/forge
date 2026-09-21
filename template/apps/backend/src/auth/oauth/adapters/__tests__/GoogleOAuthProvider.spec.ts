import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { ExchangeParams } from '../../IOAuthProvider';
import { GoogleOAuthProvider } from '../GoogleOAuthProvider';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

const CLIENT_ID = 'google-client-id';
// Self-named on purpose (see tools/sanitize.mjs's SELF_NAMED_VALUE): a value
// identical to its own UPPER_SNAKE key is published in the source by
// definition, so there is nothing here for the sanitize gate to catch.
const OAUTH_GOOGLE_CLIENT_SECRET = 'OAUTH_GOOGLE_CLIENT_SECRET';

const ACCESS_TOKEN_VALUE = 'stub-access-token-value';

const EXCHANGE_PARAMS: ExchangeParams = {
  code: 'authorization-code',
  codeVerifier: 'pkce-verifier-value',
  redirectUri: 'https://app.example.test/auth/oauth/callback',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** A userinfo body carrying only what a fixture opts into — nothing defaulted. */
function userinfoBody(fields: Record<string, unknown>): Record<string, unknown> {
  return fields;
}

function stubHttp(options: {
  tokenStatus?: number;
  tokenBody?: unknown;
  userinfoStatus?: number;
  userinfoBody?: unknown;
}): jest.Mock {
  const {
    tokenStatus = 200,
    tokenBody = { access_token: ACCESS_TOKEN_VALUE },
    userinfoStatus = 200,
    userinfoBody: stubbedUserinfo = userinfoBody({
      sub: 'google-subject-1', email: 'ada@example.test', email_verified: true,
    }),
  } = options;

  return jest.fn(async (url: string | URL) => {
    const href = String(url);
    if (href === TOKEN_ENDPOINT) return jsonResponse(tokenStatus, tokenBody);
    if (href === USERINFO_ENDPOINT) return jsonResponse(userinfoStatus, stubbedUserinfo);
    throw new Error(`GoogleOAuthProvider test stub: unexpected fetch to ${href}`);
  });
}

function adapterWith(http: jest.Mock): GoogleOAuthProvider {
  return new GoogleOAuthProvider(
    { clientId: CLIENT_ID, clientSecret: OAUTH_GOOGLE_CLIENT_SECRET },
    http as unknown as typeof fetch,
  );
}

describe('GoogleOAuthProvider', () => {
  describe('authorizationUrl', () => {
    it('builds a URL at Google\'s own authorization endpoint, carrying state and the PKCE challenge', () => {
      const adapter = adapterWith(stubHttp({}));

      const url = new URL(adapter.authorizationUrl({
        state: 'state-value',
        codeChallenge: 'challenge-value',
        redirectUri: 'https://app.example.test/auth/oauth/callback',
      }));

      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('state')).toBe('state-value');
      expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('never carries the client secret', () => {
      const adapter = adapterWith(stubHttp({}));

      const url = adapter.authorizationUrl({
        state: 's', codeChallenge: 'c', redirectUri: 'https://app.example.test/cb',
      });

      expect(url).not.toContain(OAUTH_GOOGLE_CLIENT_SECRET);
    });
  });

  describe('fetchAccount', () => {
    it('sends the client secret in the request body, never in the URL', async () => {
      // A secret in a query string is a secret in every proxy log between here
      // and the provider.
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const [url, init] = http.mock.calls[0] as [string, RequestInit];
      expect(String(url)).not.toContain(OAUTH_GOOGLE_CLIENT_SECRET);
      expect(String(init.body)).toContain('client_secret=');
      expect(String(init.body)).toContain(OAUTH_GOOGLE_CLIENT_SECRET);
    });

    it('sends the PKCE verifier, and never a challenge, to the token endpoint', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const [, init] = http.mock.calls[0] as [string, RequestInit];
      const body = String(init.body);
      expect(body).toContain(`code_verifier=${EXCHANGE_PARAMS.codeVerifier}`);
      expect(body).not.toContain('code_challenge');
    });

    it('reports an address Google marked unverified as unverified', async () => {
      // The single most important line in this adapter: `email_verified` is a
      // boolean in the userinfo response and providers do send `false`. Coercing
      // it, defaulting it to true, or omitting it turns D11's refusal into a
      // silent sign-in.
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({
          sub: 'google-subject-1', email: 'ada@example.test', email_verified: false,
        }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        emailVerified: false,
      });
    });

    it('treats a missing email_verified as unverified', async () => {
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({ sub: 'google-subject-1', email: 'ada@example.test' }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        emailVerified: false,
      });
    });

    it('would only report verified for the literal boolean true, not a truthy stand-in', async () => {
      // Derived from the rule itself (a provider-asserted address must not link on
      // its own say-so unless the provider said exactly `true`), not from whatever
      // this file's own coercion happened to do — a string "true" is not the
      // boolean `true`, and treating it as one would be exactly the coercion this
      // adapter must not perform.
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({
          sub: 'google-subject-1', email: 'ada@example.test', email_verified: 'true',
        }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        emailVerified: false,
      });
    });

    it('throws when the token endpoint answers a non-2xx', async () => {
      // The body still carries a well-shaped access token, so this fails only if
      // the status is actually checked — not by accident, via some other field
      // this fixture happens to omit.
      const adapter = adapterWith(stubHttp({
        tokenStatus: 401,
        tokenBody: { access_token: ACCESS_TOKEN_VALUE, error: 'invalid_grant' },
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/401/);
    });

    it('throws when the userinfo response carries no subject', async () => {
      // A FederatedAccount with no subject identifies nobody, and an identity
      // keyed on an empty string is an identity every such response would match.
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({ email: 'ada@example.test', email_verified: true }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow();
    });

    it('throws when the userinfo response carries an empty-string subject', async () => {
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({ sub: '', email: 'ada@example.test', email_verified: true }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow();
    });

    it('reports the account Google actually returned, subject and all', async () => {
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({
          sub: 'google-subject-1',
          email: 'ada@example.test',
          email_verified: true,
          name: 'Ada Lovelace',
        }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toEqual({
        provider: AuthProvider.GOOGLE,
        subject: 'google-subject-1',
        email: 'ada@example.test',
        emailVerified: true,
        displayName: 'Ada Lovelace',
      });
    });

    it('returns no access credential, refresh credential or raw provider payload', async () => {
      // IOAuthProvider's own contract: an adapter returns a FederatedAccount and
      // nothing else. A provider credential this application keeps is one it can
      // leak, and nothing needs it after the exchange.
      const adapter = adapterWith(stubHttp({}));

      const account = await adapter.fetchAccount(EXCHANGE_PARAMS);

      expect(Object.keys(account).sort()).toEqual(
        ['displayName', 'email', 'emailVerified', 'provider', 'subject'].sort(),
      );
    });
  });
});
