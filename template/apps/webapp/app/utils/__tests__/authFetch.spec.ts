import { describe, expect, it } from 'vitest';
import { ApiError } from '~/fetchers';
import type { ApiClient, ApiErrorCode, ApiRequest } from '~/types';
import { createAuthFetch } from '~/utils/authFetch';

/**
 * The renew-once-and-retry-once wrapper.
 *
 * The world here is a scripted transport: a list of answers, handed out in
 * order, recording what it was asked for. That is a stand-in for the network and
 * not a re-implementation of anything in `app/` — the thing under test is the
 * wrapper's decisions, and every expectation below is about what the transport
 * was asked, which the transport records rather than the wrapper reporting.
 */

/** A refusal with the status the backend would use, and no domain code. */
function refusal(status: number): ApiError {
  return new ApiError(status, { error: 'Unauthorized', message: 'errors.http.unauthorized' });
}

/**
 * A refusal the **domain** named — the shape the backend's filter emits when its
 * `DOMAIN_ERRORS` table matches.
 */
function namedRefusal(status: number, code: ApiErrorCode): ApiError {
  return new ApiError(status, { error: 'Unauthorized', message: 'errors.auth.invalid_credentials', code });
}

/** The transport, plus what it was asked. */
interface Scripted {
  client: ApiClient;
  /** Every request it was given, in order. */
  seen: ApiRequest[];
}

/**
 * A transport that answers with `script` in order, throwing anything that is an
 * `Error` and resolving with anything else.
 */
function scripted(script: readonly unknown[]): Scripted {
  const seen: ApiRequest[] = [];
  let next = 0;
  const client = (async <T>(request: ApiRequest): Promise<T> => {
    seen.push(request);
    const answer = script[next] ?? script[script.length - 1];
    next += 1;
    if (answer instanceof Error) throw answer;
    return answer as T;
  }) as ApiClient;
  return { client, seen };
}

const REQUEST: ApiRequest = { method: 'GET', path: '/users/me' };

describe('createAuthFetch', () => {
  it('passes an answer straight through', async () => {
    const world = scripted([{ ok: true }]);
    const renewals: number[] = [];

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => {
        renewals.push(1);
        return true;
      },
    });

    await expect(client(REQUEST)).resolves.toEqual({ ok: true });
    expect(world.seen).toHaveLength(1);
    expect(renewals).toHaveLength(0);
  });

  it('renews once and retries once when the credential has lapsed', async () => {
    const world = scripted([refusal(401), { ok: true }]);
    let renewals = 0;

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => {
        renewals += 1;
        return true;
      },
    });

    await expect(client(REQUEST)).resolves.toEqual({ ok: true });
    expect(renewals).toBe(1);
    expect(world.seen).toHaveLength(2);
  });

  /**
   * **The bound.** A second `401` is thrown, not renewed again.
   *
   * Written the other way — recursively, or in a loop — a request made with a
   * session the server has ended renews, retries, is refused, renews, and the
   * application spends the rest of the page's life hammering its own backend
   * with a credential that will never be accepted. There is no retry count that
   * makes it safe, because the failing case is exactly the case that repeats.
   */
  it('gives up after one retry rather than looping', async () => {
    const world = scripted([refusal(401)]);
    let renewals = 0;

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => {
        renewals += 1;
        return true;
      },
    });

    await expect(client(REQUEST)).rejects.toThrow(ApiError);
    expect(renewals).toBe(1);
    expect(world.seen).toHaveLength(2);
  });

  it('rethrows the refusal the server actually sent when the renewal fails', async () => {
    const world = scripted([refusal(401)]);

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => false,
    });

    await expect(client(REQUEST)).rejects.toMatchObject({ status: 401 });
    expect(world.seen).toHaveLength(1);
  });

  /**
   * The discriminator, and the reason it exists.
   *
   * A `401` on a request that presented nothing is not a credential that lapsed,
   * because there was no credential. Without this, a refused sign-in — a bare
   * `401` with no `code`, which is exactly what the guard answers — triggered a
   * renewal, the renewal failed too, and the store answered `anonymous`: the
   * sign-in page reported a refusal *and* signed the visitor out. Caught by the
   * store's own spec while it was being written.
   */
  it('does not renew for a refusal of a request that presented nothing', async () => {
    const world = scripted([refusal(401)]);
    let renewals = 0;

    const client = createAuthFetch({
      inner: world.client,
      presented: () => null,
      awaitingRenewal: () => false,
      renew: async () => {
        renewals += 1;
        return true;
      },
    });

    await expect(client(REQUEST)).rejects.toMatchObject({ status: 401 });
    expect(renewals).toBe(0);
    expect(world.seen).toHaveLength(1);
  });

  // A `403`, a `404` and a `409` are answers about the request. Renewing changes
  // none of them, and a wrapper that renewed on all of them would rotate the
  // session every time somebody asked for a page they may not see.
  it.each([400, 403, 404, 409, 422, 500])('does not renew for a %d', async (status) => {
    const world = scripted([refusal(status)]);
    let renewals = 0;

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => {
        renewals += 1;
        return true;
      },
    });

    await expect(client(REQUEST)).rejects.toMatchObject({ status });
    expect(renewals).toBe(0);
    expect(world.seen).toHaveLength(1);
  });

  it('does not renew for a failure that is not an ApiError at all', async () => {
    const world = scripted([new TypeError('the network went away')]);
    let renewals = 0;

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => {
        renewals += 1;
        return true;
      },
    });

    await expect(client(REQUEST)).rejects.toThrow(TypeError);
    expect(renewals).toBe(0);
  });

  it('does NOT renew for a 401 the domain named, and does NOT re-send it', async () => {
    // A wrong *current* password is `InvalidCredentialsError` — a 401 carrying
    // `INVALID_CREDENTIALS`. It is an answer about the request, not about the
    // credential, and it used to be renewed and retried: the recorded paths for
    // one mistyped password were
    // `['/auth/change-password', '/auth/refresh', '/auth/change-password']`.
    //
    // The re-send is the damaging half. Anything on the backend counting failed
    // attempts sees two for one, so a lockout fires after half as many tries as
    // it advertises. Asserting the transport was asked **once** is what catches
    // that; asserting only "no renewal" would pass for a version that skipped
    // the renewal and retried anyway.
    const world = scripted([namedRefusal(401, 'INVALID_CREDENTIALS')]);
    const renewals: number[] = [];

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => {
        renewals.push(1);
        return true;
      },
    });

    await expect(client({ method: 'POST', path: '/auth/change-password' })).rejects.toThrow();

    expect(renewals).toEqual([]);
    expect(world.seen).toHaveLength(1);
  });

  /**
   * **The two `401`s that are the same `401`.**
   *
   * Since the access credential left the SSR payload, a browser hydrates
   * believing in a session and holding nothing, and renews once on hydration
   * (`plugins/auth-init.client.ts`). A request that overtakes that plugin
   * presents nothing and is refused — with a bare `401`, no domain `code`, no
   * body worth reading. A mistyped password at sign-in produces a refusal that
   * is **identical in every one of those respects**, which is why both halves
   * are in one test: they are built from the same `refusal(401)` and differ in
   * exactly one thing, the store's own belief about whether a session exists.
   *
   * The first half must renew, or a signed-in visitor's first data request fails
   * and the page renders empty for somebody who is signed in.
   *
   * The second half must not, and it is Task 16's regression: a version without
   * the discriminator renewed on every mistyped password, the renewal failed too
   * because there was nothing to renew, the store answered `anonymous`, and the
   * sign-in page reported a refusal **and** signed the visitor out. That the
   * discriminator changed is exactly why this is re-run here rather than trusted.
   *
   * `awaitingRenewal` cannot drift into being true for the second half: it reads
   * the store's `status`, a refused renewal sets `anonymous` on the way out, and
   * a store nobody has signed into is `unknown`. Both are `false`. The store's
   * own spec drives that end to end rather than asserting it here.
   */
  it('renews on a hydration 401 and still does not renew on a refused sign-in', async () => {
    // Hydrated: the server render said this visitor is signed in, and the
    // browser has not yet earned a credential of its own.
    const hydrating = scripted([refusal(401), { ok: true }]);
    const hydrationRenewals: number[] = [];
    const hydrated = createAuthFetch({
      inner: hydrating.client,
      presented: () => null,
      awaitingRenewal: () => true,
      renew: async () => {
        hydrationRenewals.push(1);
        return true;
      },
    });

    await expect(hydrated(REQUEST)).resolves.toEqual({ ok: true });
    expect(hydrationRenewals).toEqual([1]);
    expect(hydrating.seen).toHaveLength(2);

    // The sign-in page: nobody is signed in, and the same bare 401 comes back.
    const signingIn = scripted([refusal(401)]);
    const signInRenewals: number[] = [];
    const anonymous = createAuthFetch({
      inner: signingIn.client,
      presented: () => null,
      awaitingRenewal: () => false,
      renew: async () => {
        signInRenewals.push(1);
        return true;
      },
    });

    await expect(anonymous({ method: 'POST', path: '/auth/login' }))
      .rejects.toMatchObject({ status: 401 });
    // No renewal, and — the half that matters to a lockout counter — the wrong
    // secret was not sent a second time.
    expect(signInRenewals).toEqual([]);
    expect(signingIn.seen).toHaveLength(1);
  });

  it('still renews for a 401 that named nothing, which is what a lapse looks like', async () => {
    // The other half, and the one that stops the rule above from being written as
    // "never renew". The JWT guard's refusal is a framework `UnauthorizedException`
    // and carries no `code`; that is the only thing that distinguishes it, and a
    // version that refused to renew for any 401 would leave every page unable to
    // recover from an ordinary lapse.
    const world = scripted([refusal(401), { ok: true }]);
    const renewals: number[] = [];

    const client = createAuthFetch({
      inner: world.client,
      presented: () => 'held',
      awaitingRenewal: () => false,
      renew: async () => {
        renewals.push(1);
        return true;
      },
    });

    await expect(client(REQUEST)).resolves.toEqual({ ok: true });

    expect(renewals).toEqual([1]);
    expect(world.seen).toHaveLength(2);
  });
});
