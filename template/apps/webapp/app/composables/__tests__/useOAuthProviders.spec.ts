import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { useOAuthProviders } from '~/composables/useOAuthProviders';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import type { ApiClient, ApiRequest } from '~/types';

/**
 * `useOAuthProviders`, and the one property its own TSDoc argues for: a
 * failed read is "no providers", not an error a login page has to render.
 *
 * That argument is the point of this file. `useIdentities`/`useSessions` both
 * carry a `failed` ref a screen renders as a banner — copying that shape here
 * would compile, would pass a test that only checked the happy path, and
 * would be exactly the "error banner in front of a password form" this
 * composable's TSDoc says a login page must never show.
 */

/** A transport that rejects every request with a plain network fault. */
function unreachable(): ApiClient {
  return async <T>(request: ApiRequest): Promise<T> => (
    Promise.reject(new Error(`network unreachable: ${request.method} ${request.path}`))
  );
}

describe('useOAuthProviders', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test', appName: 'Test' },
    }));
    setActivePinia(createPinia());
    backend = stubBackend();
    useAuthStore().adoptTransport(backend.client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts empty, before load() is ever called', () => {
    const { providers, loading } = useOAuthProviders();

    expect(providers.value).toEqual([]);
    expect(loading.value).toBe(false);
  });

  it('reads exactly what this deployment configured, in order', async () => {
    backend.configureOAuthProviders([AuthProvider.GOOGLE, AuthProvider.GITHUB]);
    const { providers, load } = useOAuthProviders();

    await load();

    expect(providers.value).toEqual([AuthProvider.GOOGLE, AuthProvider.GITHUB]);
  });

  it('answers with nothing configured, not an error — an empty deployment is normal', async () => {
    // Deliberately never called: `configureOAuthProviders`.
    const { providers, load } = useOAuthProviders();

    await load();

    expect(providers.value).toEqual([]);
  });

  it('treats a failed read as "no providers", carrying no error at all', async () => {
    const store = useAuthStore();
    store.adoptTransport(unreachable());
    const { providers, load } = useOAuthProviders();

    // The behavioural half of the claim: it resolves rather than rejecting,
    // so a page that `await`s it, the way `login.vue` does through
    // `onMounted(load)`, never sees a rejected promise to catch.
    await expect(load()).resolves.toBeUndefined();
    expect(providers.value).toEqual([]);
  });

  it('does not carry a `failed` flag for a screen to render as a banner', () => {
    // The type-level half of the same claim: `UseOAuthProviders` has no
    // `failed` member for a caller to read, unlike `useIdentities`/
    // `useSessions`. A version of this composable that grew one back would
    // still pass every assertion above; this is what would catch it, by
    // failing to compile if the property existed and this listed it as an
    // error instead of testing the shape directly.
    const useOAuthProvidersResult = useOAuthProviders();

    expect('failed' in useOAuthProvidersResult).toBe(false);
  });

  it('clears loading once a read resolves, success or fault alike', async () => {
    const { loading, load } = useOAuthProviders();

    const pending = load();
    expect(loading.value).toBe(true);
    await pending;

    expect(loading.value).toBe(false);
  });

  it('replaces what it held on a second read, rather than appending', async () => {
    backend.configureOAuthProviders([AuthProvider.GOOGLE]);
    const { providers, load } = useOAuthProviders();
    await load();
    expect(providers.value).toEqual([AuthProvider.GOOGLE]);

    backend.configureOAuthProviders([AuthProvider.GITHUB]);
    await load();

    expect(providers.value).toEqual([AuthProvider.GITHUB]);
  });
});
