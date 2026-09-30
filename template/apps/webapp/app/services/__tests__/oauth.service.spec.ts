import { describe, expect, it } from 'vitest';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { ApiError, postLogin } from '~/fetchers';
import { authorizationPathFor, OAuthHttpService } from '~/services';
import type { ApiClient, ApiRequest } from '~/types';
import type { StubBackend } from './stubBackend';
import { stubBackend } from './stubBackend';

/**
 * `OAuthHttpService` and `authorizationPathFor` are on no `I*Service`
 * contract and are driven by no shared conformance suite (DEC-1) — this file
 * is their entire proof, the same way `auth.service.seam.spec.ts` is the
 * entire proof of `AuthHttpService.takeIssuedCredential`.
 *
 * The two symbols are proven differently on purpose, because they are
 * opposite halves of the one asymmetry this module exists to keep straight:
 *
 * - `beginLink` is a `fetch`. Its tests build a client that presents a real,
 *   world-issued credential — never `actor`, the conformance suites' own
 *   test-only shortcut — because the claim under test is specifically that
 *   the credential, and nothing else, is what the backend reads to decide
 *   who is linking.
 * - `authorizationPathFor` issues no request at all — its own tests build no
 *   client, because its signature has none to accept, and assert on the
 *   returned string (and its synchronicity) alone.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const userJSON = (id: string, email: string): UserJSON => ({
  id: id as UserId,
  email,
  displayName: 'A User',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
});

const USER_A = userJSON('stub-User-1', 'ada@example.test');
const USER_B = userJSON('stub-User-2', 'grace@example.test');

/**
 * A client that presents `credential` on every request — the shape of the
 * real, already-signed-in transport `OAuthHttpService` is actually built
 * with in production, where `createApiClient` attaches whatever credential
 * `options.credential()` currently returns regardless of anything the
 * fetcher put on the request. Building it this way, rather than passing
 * `actor` through the fetcher, is the point: `actor` is the conformance
 * suites' own affordance for driving one stub as several people at once
 * (see `ApiRequest.actor`), and a real browser has no such field — it has
 * exactly one credential, presented or not.
 */
function clientWithCredential(backend: StubBackend, credential: string | null): ApiClient {
  return async <T>(request: ApiRequest): Promise<T> =>
    backend.client<T>({ ...request, ...(credential === null ? {} : { credential }) });
}

/** Signs a seeded user in and returns the credential the world actually issued. */
async function signIn(backend: StubBackend, email: string): Promise<string> {
  const response = await postLogin(backend.client, { email, secret: PLAINTEXT });
  // The seeded users hold no second factor, so a challenge here is a fixture
  // that has changed underneath this helper, and the honest answer is to stop.
  if (response.status === AuthenticationStatus.MFA_REQUIRED) {
    throw new Error(`${email} answered with a second-factor challenge; this helper signs in one that has none.`);
  }
  return response.accessToken;
}

describe('OAuthHttpService.listProviders', () => {
  it('answers with nothing configured, not an error — an empty deployment is normal', async () => {
    const backend = stubBackend();
    const service = new OAuthHttpService(backend.client);

    await expect(service.listProviders()).resolves.toEqual([]);
  });

  it('answers with exactly what this deployment configured, in order', async () => {
    const backend = stubBackend();
    backend.configureOAuthProviders([AuthProvider.GOOGLE, AuthProvider.GITHUB]);
    const service = new OAuthHttpService(backend.client);

    await expect(service.listProviders()).resolves.toEqual([
      AuthProvider.GOOGLE,
      AuthProvider.GITHUB,
    ]);
  });
});

describe('OAuthHttpService.beginLink — carries the access credential', () => {
  it('is refused with no credential presented — it is an authenticated route', async () => {
    const backend = stubBackend();
    backend.configureOAuthProviders([AuthProvider.GOOGLE]);
    const service = new OAuthHttpService(clientWithCredential(backend, null));

    await expect(service.beginLink(AuthProvider.GOOGLE)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('refuses a provider this deployment never configured, once authenticated', async () => {
    const backend = stubBackend();
    backend.putUser(USER_A, PLAINTEXT);
    // Deliberately empty — GOOGLE is never configured.
    const credential = await signIn(backend, USER_A.email);
    const service = new OAuthHttpService(clientWithCredential(backend, credential));

    await expect(service.beginLink(AuthProvider.GOOGLE)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('resolves with an authorization URL identifying the credential\'s own actor', async () => {
    const backend = stubBackend();
    backend.putUser(USER_A, PLAINTEXT);
    backend.putUser(USER_B, PLAINTEXT);
    backend.configureOAuthProviders([AuthProvider.GOOGLE]);
    const credentialA = await signIn(backend, USER_A.email);
    const credentialB = await signIn(backend, USER_B.email);

    const urlForA = await new OAuthHttpService(clientWithCredential(backend, credentialA))
      .beginLink(AuthProvider.GOOGLE);
    const urlForB = await new OAuthHttpService(clientWithCredential(backend, credentialB))
      .beginLink(AuthProvider.GOOGLE);

    // Not a shape assertion alone: each URL names the actor the WORLD
    // resolved from the credential that was presented, not a value either
    // client supplied — proving the credential is what selected the actor,
    // rather than the two calls happening to answer identically regardless
    // of who asked.
    expect(urlForA).toContain(`actor=${String(USER_A.id)}`);
    expect(urlForB).toContain(`actor=${String(USER_B.id)}`);
    expect(urlForA).not.toContain(`actor=${String(USER_B.id)}`);
  });
});

describe('authorizationPathFor — a path, never a request', () => {
  it('builds the sign-in path with no redirectTo', () => {
    expect(authorizationPathFor(AuthProvider.GOOGLE, null)).toBe('/auth/oauth/GOOGLE');
  });

  it('carries redirectTo as an encoded query parameter', () => {
    const path = authorizationPathFor(AuthProvider.GITHUB, '/account/identities?ok=1');
    expect(path).toBe(
      '/auth/oauth/GITHUB?redirectTo=%2Faccount%2Fidentities%3Fok%3D1',
    );
  });

  // The behavioural half of "performs no request at all": a function that
  // issues one, however it is written, returns a `Promise` — `async`,
  // `.then`-returning, or otherwise. This resolves synchronously to a plain
  // string, which a version that started fetching anything could not do.
  // The type-level half of the same claim is the signature itself: it takes
  // no `ApiClient`, so there is nothing in scope for a rewrite to call.
  it('resolves synchronously — no `Promise` in sight, so nothing was awaited', () => {
    const result = authorizationPathFor(AuthProvider.OIDC, null);
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe('string');
  });
});

describe('ApiError import sanity', () => {
  // Guards the test file's own setup: if the fetchers stopped exporting
  // `ApiError`, every `rejects.toMatchObject({ status })` above would still
  // pass against a plain rejected value carrying no `status` at all coincidentally,
  // which would make this whole suite unable to fail on a missing 401/404.
  it('is the type every rejection above is actually an instance of', async () => {
    const backend = stubBackend();
    const service = new OAuthHttpService(clientWithCredential(backend, null));

    try {
      await service.beginLink(AuthProvider.GOOGLE);
      expect.fail('expected beginLink to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
    }
  });
});
