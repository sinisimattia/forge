import { ApiError } from '~/fetchers';
import type { ApiClient, ApiRequest } from '~/types';

/**
 * What {@link createAuthFetch} needs to do its one job.
 */
export interface AuthFetchOptions {
  /**
   * The transport the request really goes out on.
   *
   * It already attaches the access credential — that is `createApiClient`'s
   * doing, from the holder it was built with. This wrapper adds nothing to the
   * request and only reacts to the answer.
   */
  readonly inner: ApiClient;
  /**
   * The access credential the transport is currently presenting, or `null`.
   *
   * It is what tells a lapsed credential apart from a refusal about the request,
   * and the two are **not** distinguishable from the status or the body: the
   * backend answers a wrong password at sign-in with a bare `401` carrying no
   * `code`, which is exactly what its guard answers for an expired credential.
   * Measured, not assumed — a version of this file without it renewed on every
   * mistyped password, and because the renewal then failed too, the store
   * answered `anonymous` and the sign-in page reported a refusal *and* signed the
   * visitor out. The store's own spec caught it.
   *
   * The rule it buys is exact: a `401` on a request that presented nothing is
   * not a credential that lapsed, because there was no credential.
   *
   * One case it does not narrow, said out loud rather than discovered: a
   * signed-in person who mistypes their *current* password does present a
   * credential, so that refusal costs one wasted renewal. A renewal is a
   * rotation, not a reuse, so it is wasteful and not dangerous — and the retry
   * is refused a second time and stops.
   *
   * That case had a caller (`app/pages/account/security.vue`) and it cost more
   * than one renewal: the retry re-sent the same body, so a **wrong secret
   * reached the backend twice for one attempt**. Anything on that side counting
   * failed attempts — a lockout, a rate limit — saw two, and a person was locked
   * out after half as many tries as the limit said. Measured, not reasoned
   * about: the recorded request paths for one mistyped password were
   * `['/auth/change-password', '/auth/refresh', '/auth/change-password']`.
   *
   * That is fixed below, by the domain `code` rather than by this file learning
   * which request it wraps. What remains true is the narrower original
   * statement: a `401` with no domain code and a non-null credential is treated
   * as a lapse, which is right for the guard and is all sign-in ever produces.
   */
  readonly presented: () => string | null;
  /**
   * Renews the session, answering whether there is one afterwards.
   *
   * This is the store's `renew`, which is idempotent under concurrency: several
   * requests that all lapse at the same moment produce one renewal between them.
   * That property belongs to the store rather than to this wrapper, and this
   * wrapper would be wrong without it — see `stores/auth.ts`.
   */
  readonly renew: () => Promise<boolean>;
}

/**
 * The transport every authenticated request goes through: `inner`, plus one
 * renewal and one retry when the credential has lapsed.
 *
 * **Once, and the word is doing work.** The retry is issued against `inner`
 * rather than against the wrapper, so a second `401` is thrown rather than
 * renewed again. Written the other way — recursively, or in a loop — a request
 * made with a session the server has ended renews, retries, is refused, renews,
 * and the application spends the rest of the page's life hammering its own
 * backend with a credential that will never be accepted. There is no bound that
 * makes that safe, because the failing case is exactly the case that repeats.
 *
 * A renewal that answers `false` rethrows the **original** refusal rather than
 * inventing one, so a caller sees the `401` the server actually sent.
 *
 * **Renewal itself must not be issued through this client, and nothing about
 * this file prevents it.** This paragraph used to say it could not happen. It
 * can: `guarded` and `transport` are both `ApiClient`, so swapping one for the
 * other on `stores/auth.ts`'s `postRefresh` line typechecks, and — measured —
 * left the whole suite green. What then happens is that a `401` from
 * `POST /auth/refresh` asks the store to renew in order to renew: the credential
 * presented is non-null, so `createAuthFetch` calls `renew()`, `renew()` hands
 * back the in-flight promise, and that promise **is this one**. It awaits itself
 * and never settles, so `initialize()` never resolves and both route middleware
 * wait forever — a page that never renders, on the session state DEC-3 produces
 * most often.
 *
 * What enforces it is a test and not a sentence:
 * `stores/__tests__/auth.spec.ts` → *answers, rather than waiting on itself, when
 * a signed-in session has been ended*. It signs in, has the world end the
 * session, and requires the renewal to resolve `false`. Under the swap it never
 * resolves and the runner's timeout turns it red.
 *
 * This file still names no path: spelling `/auth/refresh` here to special-case it
 * would put a path outside `fetchers/`, where the whole application can then stop
 * believing that `fetchers/` is the only place one appears.
 *
 * @param options - the transport to wrap and the renewal to call
 * @returns a client with the same signature, which callers cannot tell apart
 */
export function createAuthFetch(options: AuthFetchOptions): ApiClient {
  return async <T>(request: ApiRequest): Promise<T> => {
    try {
      return await options.inner<T>(request);
    } catch (error) {
      // Only a lapsed credential. A `403`, a `404` and a `409` are answers about
      // the request, and renewing changes none of them.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      // **A `401` the domain named is an answer about the request too.** The
      // backend's filter attaches `code` only for an exception its `DOMAIN_ERRORS`
      // table matches; a framework `401` — the JWT guard's, and the bare one
      // sign-in throws for a refusal — takes the generic branch and carries none.
      // So "the envelope names a domain error" is exactly "this is not a lapsed
      // credential", said without this file learning anything about which request
      // it is wrapping.
      //
      // `!== undefined` rather than a named code, deliberately: a 401 domain error
      // added later is then covered in the safe direction, rather than silently
      // acquiring a renewal and a retry.
      //
      // Two invariants hold this up, and both are asserted rather than greppable —
      // in the backend's own filter spec, which is where they are facts:
      // *the wire vocabulary this API emits* → `no framework refusal carries a
      // domain code` and `INVALID_CREDENTIALS is the only 401 the domain names`.
      if (error.body.code !== undefined) throw error;
      if (options.presented() === null) throw error;
      if (!(await options.renew())) throw error;
      return options.inner<T>(request);
    }
  };
}
