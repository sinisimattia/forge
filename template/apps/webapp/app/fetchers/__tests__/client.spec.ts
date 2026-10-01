import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, DEFAULT_API_TIMEOUT_MS } from '../client';

/**
 * The one place a *hung* backend — as opposed to a down one — is bounded.
 *
 * `plugins/auth-init.client.ts` awaits `store.renew()` on an already-rendered
 * page, and `store.renew()` goes out on `createApiClient`. Before this file's
 * subject existed, a `fetch` that never settles left that `await`, and
 * therefore Nuxt's mount, waiting forever — see `DEFAULT_API_TIMEOUT_MS`'s own
 * documentation for why the bound lives here rather than at that one call
 * site. This spec drives the bound directly, with `timeoutMs` overridden to a
 * few milliseconds so the test does not have to wait out the production
 * default to prove it fires.
 */
describe('createApiClient — the bound on a hung backend', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects rather than hanging forever when fetch never settles', async () => {
    // A `fetch` that never resolves or rejects **on its own** — the shape of a
    // backend that accepted the connection and then said nothing — but, like
    // the platform's real `fetch`, does reject when the `signal` it was handed
    // aborts. That is the one behaviour this test needs from the double: it is
    // what proves `createApiClient` actually wires the signal through, rather
    // than merely constructing one and discarding it.
    vi.stubGlobal(
      'fetch',
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as unknown as Error);
          });
        }),
    );

    const client = createApiClient({
      baseUrl: 'http://backend.test',
      credential: () => null,
      timeoutMs: 5,
    });

    // Racing against a short real delay is what makes this test fail without
    // the bound: with no timeout, `client(...)` never settles, `Promise.race`
    // never resolves either, and the test times out red rather than passing
    // green — there is no way for this assertion to pass by accident.
    const settledFirst = await Promise.race([
      client({ method: 'GET', path: '/auth/refresh', withCookie: true }).then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      ),
      new Promise<'still-pending'>((resolve) => {
        setTimeout(() => resolve('still-pending'), 200);
      }),
    ]);

    expect(settledFirst).toBe('rejected');
  });

  it('does not touch a request that answers well inside the bound', async () => {
    vi.stubGlobal(
      'fetch',
      () =>
        Promise.resolve({
          status: 200,
          ok: true,
          statusText: 'OK',
          text: () => Promise.resolve(JSON.stringify({ ok: true })),
          headers: { getSetCookie: () => [] },
        } as unknown as Response),
    );

    const client = createApiClient({
      baseUrl: 'http://backend.test',
      credential: () => null,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
    });

    await expect(client({ method: 'GET', path: '/health' })).resolves.toEqual({ ok: true });
  });
});

describe('createApiClient — a body that is not JSON', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answering = (status: number, statusText: string, text: string): void => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        status,
        ok: status >= 200 && status < 300,
        statusText,
        text: () => Promise.resolve(text),
        headers: { getSetCookie: () => [] },
      } as unknown as Response),
    );
  };
  const client = createApiClient({ baseUrl: 'http://backend.test', credential: () => null });

  it('turns a proxy HTML error page into an ApiError carrying the status', async () => {
    answering(502, 'Bad Gateway', '<html><body>502 Bad Gateway</body></html>');

    const failure: unknown = await client({ method: 'GET', path: '/users/me' }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(502);
    expect((failure as ApiError).body).toEqual({ error: 'Bad Gateway', message: 'Bad Gateway' });
  });

  it('refuses a success whose body is not JSON rather than returning it as a value', async () => {
    answering(200, 'OK', '<html>please sign in to the wifi</html>');

    const failure: unknown = await client({ method: 'GET', path: '/users/me' }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiError);
  });
});
