import type { ApiClient, ApiErrorBody, ApiRequest } from '~/types';

/**
 * A refusal that arrived over the wire, before anybody decided what it means.
 *
 * It is deliberately *not* a domain error. The fetchers throw this and nothing
 * else; turning it into `UserNotFoundError` or `ConsumedTokenError` is the
 * service's job, because only the service knows which contract it is honouring
 * and therefore which of the several core errors a `404` stands for. A fetcher
 * that mapped errors would have to know about every service that calls it.
 */
export class ApiError extends Error {
  /** The HTTP status the server answered with. */
  public readonly status: number;
  /** The parsed body, or a synthesised one when the server sent no JSON. */
  public readonly body: ApiErrorBody;

  /**
   * @param status - the HTTP status
   * @param body - the parsed error envelope
   */
  public constructor(status: number, body: ApiErrorBody) {
    super(`${status} ${body.error}: ${body.message}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * How long a single request is given to answer before this transport gives up
 * on it, in milliseconds.
 *
 * **Why this exists, and why here rather than at each call site.** A *down*
 * backend fails a `fetch` immediately — connection refused — and every caller
 * already handles that, the same way it handles any other rejection. A *hung*
 * one (accepts the connection, never answers) does not fail at all, and without
 * a bound `await` never returns. Every caller of {@link createApiClient} shares
 * that exposure, not only `plugins/auth-init.client.ts`'s `await store.renew()`
 * that surfaced it: `utils/authFetch.ts`'s retry, the route middleware's
 * `initialize()`, and every fetcher a component or composable awaits directly
 * would each hang the same way on the same kind of backend. Bounding it once
 * here, rather than wrapping each `await` in its own race, is also what keeps a
 * timed-out request from sitting on one of the browser's small number of
 * per-origin connections for the rest of the page's life.
 *
 * **What happens when it fires.** `AbortSignal.timeout` aborts the `fetch`,
 * which rejects the same way a network failure already does — this transport
 * adds no new error type and no new branch. For the renewal specifically, that
 * rejection reaches `attemptRenewal`'s existing catch-all in `stores/auth.ts`,
 * whose own comment already treats every renewal failure as "no session":
 * `forget()` runs and `status` becomes `anonymous`. The already-rendered page
 * stays up — nothing here blocks hydration past this bound — and a visitor
 * whose backend was merely slow signs in again, the same outcome a refused
 * renewal already produces today, just no longer an indefinite one.
 */
export const DEFAULT_API_TIMEOUT_MS = 10_000;

/** How a real {@link ApiClient} reaches the backend. */
export interface ApiClientOptions {
  /** `runtimeConfig.public.apiBase`, or `runtimeConfig.apiBaseServer` under SSR. */
  readonly baseUrl: string;
  /**
   * The access credential the application currently holds, or `null`.
   *
   * A function rather than a value, because the credential is replaced on every
   * renewal and a client built once must present the current one, not the one
   * that existed when it was built.
   */
  readonly credential: () => string | null;
  /**
   * Extra headers to put on every request this client issues.
   *
   * It exists for exactly one caller and could not be written without it.
   * Under SSR there is no browser to carry the renewal cookie: the request is
   * made by a Node process that was *handed* one by the browser, and the only
   * way it travels onward is if this application copies it across by hand. The
   * server-side client is therefore built with a `cookie` header taken from the
   * incoming request. See `plugins/auth-init.server.ts`.
   *
   * A function rather than a value for the same reason `credential` is one: the
   * client is built once per request and the headers it forwards must be read
   * when the request is issued, not when the client was assembled.
   */
  readonly headers?: () => Readonly<Record<string, string>>;
  /**
   * Called with every `Set-Cookie` the response carried, if any.
   *
   * Also SSR's, and also unavoidable. A renewal **rotates** the credential: the
   * server answers with a new cookie and treats the old one as spent. In a
   * browser that is invisible — the browser stores it. In Node nothing stores
   * it, so unless the values are relayed onto the response this process is
   * building, SSR renews, keeps the new credential in a variable that is
   * discarded when the render ends, and the browser is left holding the spent
   * one. The next renewal presents it, and the backend's reuse detection
   * correctly treats that as a stolen credential and revokes the whole session
   * family (DEC-3). The symptom is a user who is signed out at random.
   */
  readonly onSetCookie?: (values: readonly string[]) => void;
  /**
   * Overrides {@link DEFAULT_API_TIMEOUT_MS} for every request this client
   * issues.
   *
   * Exists for tests that need to observe the bound firing without waiting out
   * the production default; nothing in this application overrides it otherwise.
   */
  readonly timeoutMs?: number;
}

/**
 * Every `Set-Cookie` on a response, or nothing.
 *
 * `Headers.getSetCookie` is the only way to read more than one of them — they
 * are the one header that may legally repeat, and `headers.get('set-cookie')`
 * collapses several into one comma-joined string that cannot be split again
 * without parsing dates. It is present in Node 22 (which `engines` pins) and in
 * current browsers; the guard is for the browsers where it is not, where the
 * header is forbidden to script anyway and the honest answer is "none".
 */
function setCookiesOf(response: Response): readonly string[] {
  const headers: { getSetCookie?: () => string[] } = response.headers;
  return typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
}

/** `path` and `query` assembled into a URL against `baseUrl`. */
function urlOf(baseUrl: string, request: ApiRequest): string {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * The transport the application really runs on.
 *
 * Native `fetch` rather than Nuxt's `$fetch`, and the reason is `credentials`:
 * the renewal cookie only travels when the request asks for it, that is a
 * `fetch` option, and using the platform's own function keeps the one place
 * DEC-3 depends on legible instead of wrapped.
 *
 * {@link ApiRequest.actor} is read and ignored here, which is not an oversight —
 * see its own documentation. A browser holds one credential; the server resolves
 * the actor from it, and a client that let the caller name somebody else would be
 * asserting something it has no way to prove.
 *
 * @param options - where the backend is and what credential to present
 * @returns a client the fetchers can issue requests through
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  return async <T>(request: ApiRequest): Promise<T> => {
    const credential = request.credential ?? options.credential();
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(options.headers === undefined ? {} : options.headers()),
    };
    if (request.body !== undefined) headers['content-type'] = 'application/json';
    if (credential !== null) headers.authorization = `Bearer ${credential}`;

    const response = await fetch(urlOf(options.baseUrl, request), {
      method: request.method,
      headers,
      // Every auth-path request, and nothing else. Omitted, the cookie the
      // backend sets on sign-in never comes back, and renewal stops working the
      // first time the access credential lapses — silently, and only in
      // production, where sessions last long enough to lapse.
      credentials: request.withCookie === true ? 'include' : 'same-origin',
      // Bounds a *hung* backend, not just a down one — see
      // `DEFAULT_API_TIMEOUT_MS`'s own documentation for why this belongs here
      // rather than at each caller.
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS),
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });

    // Before anything can throw. A refusal can still rotate — the backend clears
    // the cookie when it revokes a session — and a relay that only ran on the
    // happy path would leave the browser holding a credential the server has
    // already forgotten.
    if (options.onSetCookie !== undefined) options.onSetCookie(setCookiesOf(response));

    // 204, and any other answer with nothing in it. `response.json()` throws on
    // an empty body, which would turn "it worked" into an unhandled parse error.
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const parsed: unknown = text === '' ? undefined : JSON.parse(text);

    if (!response.ok) {
      // A body that is not the envelope — a proxy's HTML error page, a gateway
      // timeout — still has to become an `ApiError`, because every caller above
      // this line is written to expect exactly one kind of failure.
      const body: ApiErrorBody = isErrorBody(parsed)
        ? parsed
        : { error: response.statusText, message: response.statusText };
      throw new ApiError(response.status, body);
    }

    return parsed as T;
  };
}

/** Whether a parsed body is the envelope the backend's exception filter emits. */
function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.error === 'string' && typeof candidate.message === 'string';
}
