import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { ExchangeParams } from '../../IOAuthProvider';
import { GitHubOAuthProvider } from '../GitHubOAuthProvider';

const AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize';
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token';
const USER_ENDPOINT = 'https://api.github.com/user';
const EMAILS_ENDPOINT = 'https://api.github.com/user/emails';

const CLIENT_ID = 'github-client-id';
// Self-named on purpose (see tools/sanitize.mjs's SELF_NAMED_VALUE): a value
// identical to its own UPPER_SNAKE key is published in the source by
// definition, so there is nothing here for the sanitize gate to catch.
const OAUTH_GITHUB_CLIENT_SECRET = 'OAUTH_GITHUB_CLIENT_SECRET';

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

/** A GitHub `/user` body carrying only what a fixture opts into — nothing defaulted. */
function userBody(fields: Record<string, unknown>): Record<string, unknown> {
  return fields;
}

function stubHttp(options: {
  tokenStatus?: number;
  tokenBody?: unknown;
  userStatus?: number;
  userBody?: unknown;
  emailsStatus?: number;
  emailsBody?: unknown;
}): jest.Mock {
  const {
    tokenStatus = 200,
    tokenBody = { access_token: ACCESS_TOKEN_VALUE },
    userStatus = 200,
    userBody: stubbedUser = userBody({ id: 583231, login: 'octocat', name: 'Ada Lovelace' }),
    emailsStatus = 200,
    emailsBody: stubbedEmails = [{ email: 'ada@example.test', primary: true, verified: true }],
  } = options;

  return jest.fn(async (url: string | URL) => {
    const href = String(url);
    if (href === TOKEN_ENDPOINT) return jsonResponse(tokenStatus, tokenBody);
    if (href === USER_ENDPOINT) return jsonResponse(userStatus, stubbedUser);
    if (href === EMAILS_ENDPOINT) return jsonResponse(emailsStatus, stubbedEmails);
    throw new Error(`GitHubOAuthProvider test stub: unexpected fetch to ${href}`);
  });
}

function adapterWith(http: jest.Mock): GitHubOAuthProvider {
  return new GitHubOAuthProvider(
    { clientId: CLIENT_ID, clientSecret: OAUTH_GITHUB_CLIENT_SECRET },
    http as unknown as typeof fetch,
  );
}

describe('GitHubOAuthProvider', () => {
  describe('authorizationUrl', () => {
    it('builds a URL at GitHub\'s own authorization endpoint, carrying state and the PKCE challenge', async () => {
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

    it('requests the user:email scope, so an under-scoped token is GitHub\'s or an organisation\'s doing, not this adapter\'s', async () => {
      const adapter = adapterWith(stubHttp({}));

      const url = new URL(await adapter.authorizationUrl({
        state: 's', codeChallenge: 'c', redirectUri: 'https://app.example.test/cb',
      }));

      const scope = url.searchParams.get('scope');
      expect(scope).toContain('user:email');
      expect(scope).toContain('read:user');
    });

    it('never carries the client secret', async () => {
      const adapter = adapterWith(stubHttp({}));

      const url = await adapter.authorizationUrl({
        state: 's', codeChallenge: 'c', redirectUri: 'https://app.example.test/cb',
      });

      expect(url).not.toContain(OAUTH_GITHUB_CLIENT_SECRET);
    });

    it('resolves without ever calling http — this adapter has no discovery to await', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.authorizationUrl({
        state: 's', codeChallenge: 'c', redirectUri: 'https://app.example.test/cb',
      });

      expect(http).not.toHaveBeenCalled();
    });
  });

  describe('fetchAccount', () => {
    it('sends the client secret in the request body, never in the URL', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const [url, init] = http.mock.calls[0] as [string, RequestInit];
      expect(String(url)).not.toContain(OAUTH_GITHUB_CLIENT_SECRET);
      expect(String(init.body)).toContain('client_secret=');
      expect(String(init.body)).toContain(OAUTH_GITHUB_CLIENT_SECRET);
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

    it('asks the token endpoint for a JSON response, not GitHub\'s default form-encoded body', async () => {
      // Without `accept: application/json`, GitHub's token endpoint answers
      // application/x-www-form-urlencoded, and `.json()` on that body throws a
      // parse error nowhere near this being the actual cause.
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const [, init] = http.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['accept']).toBe('application/json');
    });

    it('sends a user-agent header to the user endpoint — GitHub\'s API rejects requests with none', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const userCall = http.mock.calls.find(([url]) => String(url) === USER_ENDPOINT) as
        [string, RequestInit];
      const headers = userCall[1].headers as Record<string, string>;
      expect(headers['user-agent']).toBeTruthy();
    });

    it('sends a user-agent header to the emails endpoint too', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      const emailsCall = http.mock.calls.find(([url]) => String(url) === EMAILS_ENDPOINT) as
        [string, RequestInit];
      const headers = emailsCall[1].headers as Record<string, string>;
      expect(headers['user-agent']).toBeTruthy();
    });

    it('sends the access token as a bearer credential to both api.github.com calls', async () => {
      const http = stubHttp({});
      const adapter = adapterWith(http);

      await adapter.fetchAccount(EXCHANGE_PARAMS);

      for (const endpoint of [USER_ENDPOINT, EMAILS_ENDPOINT]) {
        const call = http.mock.calls.find(([url]) => String(url) === endpoint) as
          [string, RequestInit];
        const headers = call[1].headers as Record<string, string>;
        expect(headers['authorization']).toBe(`Bearer ${ACCESS_TOKEN_VALUE}`);
      }
    });

    it('keys the identity on the numeric id, not the login name', async () => {
      // A GitHub login can be changed and can be taken over by somebody else
      // after it is released. The numeric id cannot. An identity keyed on the
      // login is an identity that transfers with the name — the account-takeover
      // path this whole phase exists to close, arriving through a different door.
      const adapter = adapterWith(stubHttp({
        userBody: userBody({ id: 583231, login: 'octocat', name: null }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        subject: '583231',
      });
    });

    it('does not key the identity on the login name', async () => {
      // The direct regression case for the above: a subject built from `login`
      // rather than `id` would also satisfy a loose "some string" assertion, so
      // this pins the login value specifically out of the result.
      const adapter = adapterWith(stubHttp({
        userBody: userBody({ id: 583231, login: 'octocat', name: null }),
      }));

      const account = await adapter.fetchAccount(EXCHANGE_PARAMS);

      expect(account.subject).not.toBe('octocat');
    });

    it('takes the primary address only when GitHub says it is verified', async () => {
      const adapter = adapterWith(stubHttp({
        emailsBody: [{ email: 'ada@example.test', primary: true, verified: true }],
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        email: 'ada@example.test', emailVerified: true,
      });
    });

    it('reports no verified address when the primary one is unverified', async () => {
      // NOT "fall back to another verified address". The primary address is the
      // one the person publishes; silently substituting another changes which
      // account a later match would find, and does it invisibly.
      const adapter = adapterWith(stubHttp({
        emailsBody: [
          { email: 'ada@example.test', primary: true, verified: false },
          { email: 'other@example.test', primary: false, verified: true },
        ],
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        emailVerified: false,
      });
    });

    it('does not substitute the other verified address for the unverified primary one', async () => {
      // The direct regression case for a "fall back to any verified entry"
      // implementation, which would satisfy `emailVerified: false` above only if
      // it happened to also null out email — this pins the actual address out.
      const adapter = adapterWith(stubHttp({
        emailsBody: [
          { email: 'ada@example.test', primary: true, verified: false },
          { email: 'other@example.test', primary: false, verified: true },
        ],
      }));

      const account = await adapter.fetchAccount(EXCHANGE_PARAMS);

      expect(account.email).not.toBe('other@example.test');
    });

    it('reports no address at all when the scope did not include one', async () => {
      const adapter = adapterWith(stubHttp({ emailsBody: [] }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        email: null, emailVerified: false,
      });
    });

    it('throws when the token endpoint answers a non-2xx', async () => {
      const adapter = adapterWith(stubHttp({
        tokenStatus: 401,
        tokenBody: { access_token: ACCESS_TOKEN_VALUE, error: 'bad_verification_code' },
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/401/);
    });

    it('throws when the token endpoint response carries no access token', async () => {
      const adapter = adapterWith(stubHttp({ tokenBody: { error: 'bad_verification_code' } }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow();
    });

    it('throws when the user endpoint answers a non-2xx', async () => {
      const adapter = adapterWith(stubHttp({ userStatus: 403 }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/403/);
    });

    it('treats a 403 from the emails endpoint as no address, not a failure', async () => {
      // This is the shape a token that cannot see addresses actually takes on
      // GitHub — an under-scoped token gets 403 here, never a 200 with an
      // empty list. Throwing on it would cost more than a failed address
      // lookup: decideFederatedSignIn's first branch signs in an
      // already-linked subject unconditionally, before any address is
      // examined, precisely so a provider that stops disclosing an address
      // cannot lock somebody out of an account they already hold. A throw
      // here would defeat that for every existing GitHub user of a
      // deployment whose token loses user:email scope.
      const adapter = adapterWith(stubHttp({ emailsStatus: 403, emailsBody: {} }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        email: null, emailVerified: false,
      });
    });

    it('treats a 404 from the emails endpoint as no address, not a failure', async () => {
      // The same signal as 403, observed on some API versions/deployments.
      const adapter = adapterWith(stubHttp({ emailsStatus: 404, emailsBody: {} }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toMatchObject({
        email: null, emailVerified: false,
      });
    });

    it('still throws when the emails endpoint answers 401 — the token itself is bad, not merely scope-limited', async () => {
      const adapter = adapterWith(stubHttp({ emailsStatus: 401, emailsBody: {} }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/401/);
    });

    it('still throws when the emails endpoint answers a 5xx — a real provider failure, not a scope question', async () => {
      const adapter = adapterWith(stubHttp({ emailsStatus: 500, emailsBody: {} }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow(/500/);
    });

    it('throws when the user endpoint response carries no id', async () => {
      // A FederatedAccount with no subject identifies nobody, and an identity
      // keyed on an empty value is an identity every such response would match.
      const adapter = adapterWith(stubHttp({
        userBody: userBody({ login: 'octocat', name: 'Ada Lovelace' }),
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).rejects.toThrow();
    });

    it('reports the account GitHub actually returned, subject and all', async () => {
      const adapter = adapterWith(stubHttp({
        userBody: userBody({ id: 583231, login: 'octocat', name: 'Ada Lovelace' }),
        emailsBody: [{ email: 'ada@example.test', primary: true, verified: true }],
      }));

      await expect(adapter.fetchAccount(EXCHANGE_PARAMS)).resolves.toEqual({
        provider: AuthProvider.GITHUB,
        subject: '583231',
        email: 'ada@example.test',
        emailVerified: true,
        displayName: 'Ada Lovelace',
      });
    });

    it('returns no access credential, refresh credential or raw provider payload', async () => {
      const adapter = adapterWith(stubHttp({}));

      const account = await adapter.fetchAccount(EXCHANGE_PARAMS);

      expect(Object.keys(account).sort()).toEqual(
        ['displayName', 'email', 'emailVerified', 'provider', 'subject'].sort(),
      );
    });
  });
});
