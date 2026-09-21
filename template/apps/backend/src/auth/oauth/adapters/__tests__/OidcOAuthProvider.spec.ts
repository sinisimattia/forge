import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { ExchangeParams } from '../../IOAuthProvider';
import { OidcOAuthProvider } from '../OidcOAuthProvider';

const ISSUER = 'https://issuer.example.test';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const AUTHORIZATION_ENDPOINT = `${ISSUER}/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const USERINFO_ENDPOINT = `${ISSUER}/userinfo`;

const CLIENT_ID = 'oidc-client-id';
// Self-named on purpose (see tools/sanitize.mjs's SELF_NAMED_VALUE): a value
// identical to its own UPPER_SNAKE key is published in the source by
// definition, so there is nothing here for the sanitize gate to catch.
const OAUTH_OIDC_CLIENT_SECRET = 'OAUTH_OIDC_CLIENT_SECRET';

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

function discoveryDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    userinfo_endpoint: USERINFO_ENDPOINT,
    ...overrides,
  };
}

/** A userinfo body carrying only what a fixture opts into — nothing defaulted. */
function userinfoBody(fields: Record<string, unknown>): Record<string, unknown> {
  return fields;
}

function stubHttp(options: {
  discoveryStatus?: number;
  discoveryBody?: unknown;
  tokenStatus?: number;
  tokenBody?: unknown;
  userinfoStatus?: number;
  userinfoBody?: unknown;
}): jest.Mock {
  const {
    discoveryStatus = 200,
    discoveryBody = discoveryDocument(),
    tokenStatus = 200,
    tokenBody = { access_token: ACCESS_TOKEN_VALUE },
    userinfoStatus = 200,
    userinfoBody: stubbedUserinfo = userinfoBody({
      sub: 'oidc-subject-1', email: 'ada@example.test', email_verified: true,
    }),
  } = options;

  return jest.fn(async (url: string | URL) => {
    const href = String(url);
    if (href === DISCOVERY_URL) return jsonResponse(discoveryStatus, discoveryBody);
    if (href === TOKEN_ENDPOINT) return jsonResponse(tokenStatus, tokenBody);
    if (href === USERINFO_ENDPOINT) return jsonResponse(userinfoStatus, stubbedUserinfo);
    throw new Error(`OidcOAuthProvider test stub: unexpected fetch to ${href}`);
  });
}

function adapterWith(http: jest.Mock): OidcOAuthProvider {
  return new OidcOAuthProvider(
    ISSUER,
    { clientId: CLIENT_ID, clientSecret: OAUTH_OIDC_CLIENT_SECRET },
    http as unknown as typeof fetch,
  );
}

describe('OidcOAuthProvider', () => {
  describe('authorizationUrl', () => {
    it('builds a URL at the discovered authorization endpoint, awaiting discovery inline', async () => {
      const adapter = adapterWith(stubHttp({}));

      const url = new URL(await adapter.authorizationUrl({
        state: 'state-value',
        codeChallenge: 'challenge-value',
        redirectUri: 'https://app.example.test/auth/oauth/callback',
      }));

      expect(url.origin + url.pathname).toBe(AUTHORIZATION_ENDPOINT);
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('state')).toBe('state-value');
      expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });
  });

  describe('discovery is fetched once and cached for the process lifetime', () => {
    it('fetches the discovery document only once across repeated authorizationUrl calls', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.authorizationUrl({ state: 's1', codeChallenge: 'c1', redirectUri: 'https://app.example.test/cb' });
      await adapter.authorizationUrl({ state: 's2', codeChallenge: 'c2', redirectUri: 'https://app.example.test/cb' });

      const discoveryCalls = http.mock.calls.filter(([url]) => String(url) === DISCOVERY_URL);
      expect(discoveryCalls).toHaveLength(1);
    });

    it('fetches the discovery document only once across repeated fetchAccount calls', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);
      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const discoveryCalls = http.mock.calls.filter(([url]) => String(url) === DISCOVERY_URL);
      expect(discoveryCalls).toHaveLength(1);
    });

    it('fetches the discovery document only once under two concurrent first calls to authorizationUrl', async () => {
      // The property that matters: the in-flight promise is cached, not just the
      // resolved value. Two calls racing before the first fetch has resolved must
      // share that one fetch rather than each starting their own — the cheap way
      // to get this subtly wrong is to check `if (this.endpoints)` and otherwise
      // just re-await `this.discover()` inline, which lets a second caller arrive
      // in the window before the first has stored anything.
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await Promise.all([
        adapter.authorizationUrl({ state: 's1', codeChallenge: 'c1', redirectUri: 'https://app.example.test/cb' }),
        adapter.authorizationUrl({ state: 's2', codeChallenge: 'c2', redirectUri: 'https://app.example.test/cb' }),
      ]);

      const discoveryCalls = http.mock.calls.filter(([url]) => String(url) === DISCOVERY_URL);
      expect(discoveryCalls).toHaveLength(1);
    });

    it('fetches the discovery document only once when authorizationUrl and fetchAccount race on the first call', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await Promise.all([
        adapter.authorizationUrl({ state: 's', codeChallenge: 'c', redirectUri: 'https://app.example.test/cb' }),
        adapter.fetchAccount(EXCHANGE_PARAMS),
      ]);

      const discoveryCalls = http.mock.calls.filter(([url]) => String(url) === DISCOVERY_URL);
      expect(discoveryCalls).toHaveLength(1);
    });
  });

  describe('the discovery document is data, not trust', () => {
    it('refuses a discovered token_endpoint on a different origin, before sending it any secret', async () => {
      // A discovery document is fetched from a configured issuer, but the
      // endpoints inside it are still provider-supplied values. A compromised or
      // malicious document naming a token_endpoint elsewhere would otherwise
      // redirect this deployment's client secret to an attacker's endpoint.
      const http = stubHttp({
        discoveryBody: discoveryDocument({ token_endpoint: 'https://attacker.example.test/token' }),
      });
      const adapter = adapterWith(http);

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/token_endpoint/);

      const tokenCalls = http.mock.calls.filter(([url]) => String(url) === 'https://attacker.example.test/token');
      expect(tokenCalls).toHaveLength(0);
    });

    it('refuses a discovered token_endpoint that is http:, not https:', async () => {
      const http = stubHttp({
        discoveryBody: discoveryDocument({ token_endpoint: `${ISSUER.replace('https:', 'http:')}/token` }),
      });
      const adapter = adapterWith(http);

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/token_endpoint/);
    });

    it('refuses a discovered userinfo_endpoint on a different origin', async () => {
      const http = stubHttp({
        discoveryBody: discoveryDocument({ userinfo_endpoint: 'https://attacker.example.test/userinfo' }),
      });
      const adapter = adapterWith(http);

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/userinfo_endpoint/);
    });

    it('accepts a discovered set of endpoints that share the issuer origin', async () => {
      const adapter = adapterWith(stubHttp({}));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        subject: 'oidc-subject-1',
      });
    });
  });

  describe('fetchAccount', () => {
    it('sends the client secret in the request body, never in the URL', async () => {
      // A secret in a query string is a secret in every proxy log between here
      // and the provider.
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const tokenCall = http.mock.calls.find(([url]) => String(url) === TOKEN_ENDPOINT) as
        [string, RequestInit];
      const [url, init] = tokenCall;
      expect(String(url)).not.toContain(OAUTH_OIDC_CLIENT_SECRET);
      expect(String(init.body)).toContain('client_secret=');
      expect(String(init.body)).toContain(OAUTH_OIDC_CLIENT_SECRET);
    });

    it('sends the PKCE verifier, and never a challenge, to the token endpoint', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const tokenCall = http.mock.calls.find(([url]) => String(url) === TOKEN_ENDPOINT) as
        [string, RequestInit];
      const body = String(tokenCall[1].body);
      expect(body).toContain(`code_verifier=${EXCHANGE_PARAMS.codeVerifier}`);
      expect(body).not.toContain('code_challenge');
    });

    it('reports an address the provider marked unverified as unverified', async () => {
      // The single most important line in this adapter: `email_verified` is a
      // boolean in the userinfo response and providers do send `false`. Coercing
      // it, defaulting it to true, or omitting it turns D11's refusal into a
      // silent sign-in.
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({
          sub: 'oidc-subject-1', email: 'ada@example.test', email_verified: false,
        }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        emailVerified: false,
      });
    });

    it('treats a missing email_verified as unverified', async () => {
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({ sub: 'oidc-subject-1', email: 'ada@example.test' }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        emailVerified: false,
      });
    });

    it('would only report verified for the literal boolean true, not a truthy stand-in', async () => {
      // Derived from the rule itself (a provider-asserted address must not link on
      // its own say-so unless the provider said exactly `true`), not from whatever
      // this file's own coercion happened to do.
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({
          sub: 'oidc-subject-1', email: 'ada@example.test', email_verified: 1,
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

    it('throws when the discovery document fetch answers a non-2xx', async () => {
      const adapter = adapterWith(stubHttp({ discoveryStatus: 500, discoveryBody: {} }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow();
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

    it('reports the account the provider actually returned, subject and all', async () => {
      const adapter = adapterWith(stubHttp({
        userinfoBody: userinfoBody({
          sub: 'oidc-subject-1',
          email: 'ada@example.test',
          email_verified: true,
          name: 'Ada Lovelace',
        }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toEqual({
        provider: AuthProvider.OIDC,
        subject: 'oidc-subject-1',
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
