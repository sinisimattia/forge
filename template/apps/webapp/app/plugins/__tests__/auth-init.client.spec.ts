import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watch } from 'vue';
import type { Pinia } from 'pinia';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import { useAuthStore } from '~/stores/auth';

/**
 * The browser's half of the session renewal, driven through `fetch`.
 *
 * ## What is standing in
 *
 * One function, `fetch`, as in the server plugin's spec and for the same reason:
 * everything above it — the plugin, the store, `createApiClient`, `postRefresh` —
 * is the shipped code, and the questions this file asks are about *when* a
 * request is issued and what the store believes while it is in flight.
 *
 * ## The hydration, which is the other half of the test
 *
 * `hydrate()` does not invent a seam. `@pinia/nuxt` restores server state with
 * `pinia.state.value = nuxtApp.payload.pinia`, before any store is instantiated,
 * and Pinia then copies each key onto the matching ref as the store is built.
 * Assigning `pinia.state.value.auth` here is that, exactly — which is why the
 * shape assigned is the payload's real shape and why `accessToken` is absent
 * from it rather than set to `null`. A payload with a credential in it is the
 * thing this task removed; a fixture that put one back would test nothing.
 */

/** One instant for the world, which nothing here compares. */
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** The person the server render resolved, as the payload carries them. */
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

/** The credential the browser's own renewal mints. A value from the world. */
const MINTED = 'minted-for-the-browser-1';

/** One call to `fetch`, as this spec reads one. */
interface Attempt {
  url: string;
  credentials: string | undefined;
  /** What the store believed at the moment the request went out. */
  statusWhileInFlight: string;
}

/** A `Response` with only what `createApiClient` reads off one. */
function answer(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 200 ? 'OK' : 'Unauthorized',
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { getSetCookie: () => [] },
  } as unknown as Response;
}

describe('plugins/auth-init.client', () => {
  let attempts: Attempt[];
  let registered: unknown[];
  let pinia: Pinia;

  /** Installs the globals, with `fetch` answering `reply`. */
  function install(reply: () => Response): void {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
    vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => {
      registered.push(plugin);
      return plugin;
    });
    vi.stubGlobal('fetch', (url: string, init: { credentials?: string }) => {
      attempts.push({
        url: String(url),
        credentials: init.credentials,
        statusWhileInFlight: useAuthStore().status,
      });
      return Promise.resolve(reply());
    });
  }

  /**
   * What `@pinia/nuxt` does with the payload, before any store exists.
   *
   * The keys are the payload's own: `status` and `user`, and no credential.
   */
  function hydrate(state: { status: string; user: UserJSON | null }): void {
    (pinia.state.value as Record<string, unknown>).auth = { ...state };
  }

  /** Loads and runs the plugin Nuxt would have registered. */
  async function run(): Promise<void> {
    vi.resetModules();
    const module = await import('~/plugins/auth-init.client');
    const plugin = module.default as unknown as { setup: (app: unknown) => Promise<void> };
    await plugin.setup({});
  }

  beforeEach(() => {
    attempts = [];
    registered = [];
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The registration, and the ordering that is the whole of the second renewal
   * race.
   *
   * `dependsOn: ['pinia']` is not decoration: `@pinia/nuxt`'s plugin (which
   * declares `name: 'pinia'`) is what copies the server render's answer into the
   * store, and a renewal issued before that spends a rotation whose result is
   * then overwritten — leaving the browser holding a spent cookie and the next
   * renewal tripping reuse detection, which revokes the whole family. Nothing
   * imports this plugin, so the line going missing is invisible to every other
   * spec.
   */
  it('is registered as a Nuxt plugin that runs after pinia', async () => {
    install(() => answer(401, { error: 'Unauthorized', message: 'no' }));
    await run();

    expect(registered).toHaveLength(1);
    const plugin = registered[0] as { name?: string; dependsOn?: string[] };
    expect(plugin.dependsOn).toContain('pinia');
    expect(typeof (registered[0] as { setup?: unknown }).setup).toBe('function');
  });

  /**
   * **The second renewal race.** The server's rotation has to have landed before
   * the client renews, and "landed" has two halves: the rotated cookie is in the
   * jar (the platform commits response headers before running any script from
   * that document), and the rotation's *outcome* is in this store (pinia's
   * plugin, which `dependsOn` orders this after).
   *
   * This is the second half, observed from the only side a test can observe it:
   * a store pinia has not hydrated is still `unknown`, and a plugin that renewed
   * anyway would spend a rotation that `pinia.state.value = payload` then
   * discards. The browser would go on holding the spent cookie, the first
   * renewal any page made would present it, reuse detection would read that as
   * theft — correctly — and the whole session family would be revoked. A visitor
   * who did nothing would be signed out.
   *
   * Asserted as "issued no request at all", because that is the failure's cause
   * rather than its symptom: the symptom arrives a page load later and on the
   * server.
   */
  it('does not renew before the server-rendered rotation has landed', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 }));

    // No `hydrate()`. Pinia has not copied the payload in yet.
    await run();

    expect(attempts).toEqual([]);
    expect(useAuthStore().status).toBe('unknown');
  });

  // The other three states, for completeness of the same rule. `anonymous` is a
  // store that asked and was told no; a credential already in hand is a page
  // that has already done this. Neither is ours to renew, and renewing on either
  // is a rotation nobody asked for.
  it('does not renew for a visitor the server render found anonymous', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 }));
    hydrate({ status: 'anonymous', user: null });

    await run();

    expect(attempts).toEqual([]);
  });

  it('renews once, and takes up the credential the world minted', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 }));
    hydrate({ status: 'authenticated', user: ACTOR });

    await run();

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.url).toBe('http://backend.test/auth/refresh');
    // The renewal cookie only travels when the request asks for it.
    expect(attempts[0]?.credentials).toBe('include');
    const store = useAuthStore();
    expect(store.accessToken).toBe(MINTED);
    expect(store.status).toBe('authenticated');
  });

  /**
   * **The no-flash behaviour, which was never what the credential bought.**
   *
   * The obvious worry about taking the credential out of the payload is that a
   * signed-in visitor gets a signed-out frame while the browser earns its own.
   * They do not, and the reason is the three-state `status`: it is seeded
   * `authenticated` by the payload, and nothing in this plugin passes through
   * `anonymous` or back through `unknown` on the way to holding a credential.
   *
   * Every value `status` takes is recorded, synchronously, for the whole of the
   * plugin's run — including the moment the renewal is in flight, which is the
   * frame a flash would occupy. Sampling before and after would go green for a
   * store that flickered in between.
   */
  it('still hydrates as authenticated without a signed-out frame', async () => {
    install(() => answer(200, { user: ACTOR, accessToken: MINTED, expiresIn: 900 }));
    hydrate({ status: 'authenticated', user: ACTOR });

    const store = useAuthStore();
    const seen: string[] = [store.status];
    const stop = watch(() => store.status, (next) => seen.push(next), { flush: 'sync' });

    await run();
    stop();

    expect(attempts[0]?.statusWhileInFlight).toBe('authenticated');
    expect(seen).toEqual(['authenticated']);
    expect(store.isAuthenticated).toBe(true);
    expect(store.currentUser?.email).toBe(ACTOR.email);
  });

  /**
   * And the failure case, which must land on `anonymous` rather than stay
   * hopeful: the server render believed in a session the browser's own renewal
   * cannot buy — the person signed out elsewhere between the render and the
   * hydration, or reuse detection has already fired. A guard waiting on
   * `initialize()` has to be released.
   */
  it('answers anonymous when the browser cannot buy a session of its own', async () => {
    install(() => answer(401, { error: 'Unauthorized', message: 'errors.http.unauthorized' }));
    hydrate({ status: 'authenticated', user: ACTOR });

    await run();

    const store = useAuthStore();
    expect(store.status).toBe('anonymous');
    expect(store.accessToken).toBeNull();
    expect(store.currentUser).toBeNull();
  });
});
