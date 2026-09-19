import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import { useAuthStore } from '~/stores/auth';

/**
 * The server-side renewal, driven through `fetch`.
 *
 * ## What is standing in, and why it is `fetch` and not the transport
 *
 * Everything above `fetch` is the shipped code: the plugin, `createApiClient`,
 * `postRefresh`, the store. What is replaced is the platform — one function,
 * which this file does not own and is not re-implementing. That matters because
 * both of the things this plugin exists to get right are **facts about the HTTP
 * request and response**: a header that has to go out, and a header that has to
 * come back. A spec that replaced the `ApiClient` instead could not see either
 * of them, and would go green for a plugin that forwarded nothing.
 *
 * ## The import path is half of the test
 *
 * Nuxt registers a plugin by where its file is. `app/plugins/` is what makes it
 * run; the `.server` in the name is what keeps it off the client, where
 * `useRequestHeaders` has nothing to read and a second renewal per page load is
 * exactly the concurrent rotation `renew` exists to prevent. Nothing imports it,
 * so deleting it or dropping the `.server` changes the running application
 * silently — unless a spec imports that exact path, which this one does.
 */

/** One instant for the world, which nothing here compares. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** The person the renewal answers with. */
const ACTOR: UserJSON = {
  id: 'stub-User-1' as UserId,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

/** The credential the renewal mints. A value from the world, not from the store. */
const MINTED = 'minted-by-the-server-1';

/** What the browser sent us, and what we must send onward. */
const INCOMING_COOKIE = 'refresh=held-by-the-browser-1; other=x';

/** What the renewal rotated to, and what must reach the browser. */
const ROTATED_COOKIE = 'refresh=rotated-by-the-server-1; HttpOnly; Path=/';

/** One call to `fetch`, as this spec reads one. */
interface Attempt {
  url: string;
  headers: Record<string, string>;
}

/** A `Response` with only what `createApiClient` reads off one. */
function answer(status: number, body: unknown, setCookies: readonly string[]): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { getSetCookie: () => [...setCookies] },
  } as unknown as Response;
}

describe('plugins/auth-init.server', () => {
  let attempts: Attempt[];
  let registered: unknown[];
  let responseHeaders: Map<string, ReturnType<typeof ref<unknown>>>;

  /** Installs the globals, with `fetch` answering `reply`. */
  function install(reply: (attempt: Attempt) => Response, incoming?: string): void {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: 'http://backend:3000',
      public: { apiBase: 'http://localhost:3000' },
    }));
    vi.stubGlobal('useRequestHeaders', (include: string[]) => {
      expect(include).toEqual(['cookie']);
      return incoming === undefined ? {} : { cookie: incoming };
    });
    vi.stubGlobal('useResponseHeader', (name: string) => {
      const held = responseHeaders.get(name) ?? ref<unknown>(undefined);
      responseHeaders.set(name, held);
      return held;
    });
    vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => {
      registered.push(plugin);
      return plugin;
    });
    vi.stubGlobal('fetch', (url: string, init: { headers: Record<string, string> }) => {
      const attempt = { url: String(url), headers: init.headers };
      attempts.push(attempt);
      return Promise.resolve(reply(attempt));
    });
  }

  /** Loads and runs the plugin Nuxt would have registered. */
  async function run(): Promise<void> {
    vi.resetModules();
    const module = await import('~/plugins/auth-init.server');
    await (module.default as unknown as (app: unknown) => Promise<void>)({});
  }

  beforeEach(() => {
    attempts = [];
    registered = [];
    responseHeaders = new Map();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is registered as a Nuxt plugin', async () => {
    install(() => answer(401, { error: 'Unauthorized', message: 'no' }, []));
    await run();

    expect(registered).toHaveLength(1);
    expect(typeof registered[0]).toBe('function');
  });

  /**
   * **Hazard one.** Nuxt's server-side `fetch` carries no cookies: the renewal
   * credential is in the browser's jar, and the render is happening in a Node
   * process that was merely handed the header. A renewal that goes out without
   * it always answers `401`, and because `401` is also the ordinary way of
   * saying "nobody is signed in", nothing is logged anywhere — the symptom is
   * "SSR never sees a signed-in user" and no error at all.
   */
  it('forwards the incoming cookie onto the renewal', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 }, []),
      INCOMING_COOKIE);

    await run();

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.url).toBe('http://backend:3000/auth/refresh');
    expect(attempts[0]?.headers.cookie).toBe(INCOMING_COOKIE);
  });

  /**
   * **Hazard two.** A renewal rotates. In a browser the new cookie is stored by
   * the browser; here nothing stores it, so unless it is relayed onto the
   * response this process is building, the server keeps the new credential in a
   * variable it throws away and the browser is left holding the spent one. The
   * next renewal presents that, reuse detection correctly reads it as theft, and
   * the whole session family is revoked.
   *
   * Asserted on the response header the plugin writes, because that is the thing
   * that actually reaches the browser.
   */
  it('relays the rotated cookie back onto the response', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 },
      [ROTATED_COOKIE]), INCOMING_COOKIE);

    await run();

    expect(responseHeaders.get('set-cookie')?.value).toEqual([ROTATED_COOKIE]);
  });

  // `Set-Cookie` is the one header that may legally repeat, and a response can
  // already carry one before this plugin runs. Appending rather than assigning
  // is what keeps both.
  it('keeps a Set-Cookie the response already carried', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 },
      [ROTATED_COOKIE]), INCOMING_COOKIE);
    responseHeaders.set('set-cookie', ref<unknown>(['locale=en; Path=/']));

    await run();

    expect(responseHeaders.get('set-cookie')?.value).toEqual(['locale=en; Path=/', ROTATED_COOKIE]);
  });

  // A refusal rotates too — the backend clears the cookie when it revokes a
  // session — so the relay has to happen before anything can throw. Left on the
  // happy path only, the browser goes on holding a credential the server has
  // already forgotten.
  it('relays a cookie that came with a refusal', async () => {
    install(() => answer(401, { error: 'Unauthorized', message: 'errors.http.unauthorized' },
      ['refresh=; Max-Age=0; Path=/']), INCOMING_COOKIE);

    await run();

    expect(responseHeaders.get('set-cookie')?.value).toEqual(['refresh=; Max-Age=0; Path=/']);
  });

  it('seeds the store with who the renewal says is signed in', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 },
      [ROTATED_COOKIE]), INCOMING_COOKIE);

    await run();

    const store = useAuthStore();
    expect(store.status).toBe('authenticated');
    expect(store.accessToken).toBe(MINTED);
    expect(store.currentUser?.email).toBe(ACTOR.email);
  });

  // The store's state travels to the browser in the SSR payload, and that state
  // now includes a bearer credential. Saying so is what keeps a shared cache
  // from handing one person's credential to the next visitor who asks for the
  // same URL.
  it('marks an authenticated response uncacheable', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 }, []),
      INCOMING_COOKIE);

    await run();

    expect(responseHeaders.get('cache-control')?.value).toBe('private, no-store');
  });

  it('answers anonymous, and caches nothing extra, when there is no session', async () => {
    install(() => answer(401, { error: 'Unauthorized', message: 'errors.http.unauthorized' }, []));

    await run();

    const store = useAuthStore();
    expect(store.status).toBe('anonymous');
    expect(store.accessToken).toBeNull();
    expect(responseHeaders.get('cache-control')?.value).toBeUndefined();
  });

  // A request that carried no cookie still asks: the browser may simply have
  // none. What it must not do is send a `cookie` header with nothing in it.
  it('sends no cookie header when the request carried none', async () => {
    install(() => answer(401, { error: 'Unauthorized', message: 'no' }, []));

    await run();

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.headers.cookie).toBeUndefined();
  });
});
