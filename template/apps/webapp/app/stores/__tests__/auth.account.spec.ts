import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { AuthHttpService } from '~/services';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import type { ApiClient, ApiRequest } from '~/types';

/**
 * The three things the store gained so that a person could manage their own
 * account: the transport other services are built on, the secret change that
 * rotates the credential, and taking up a saved profile.
 *
 * Driven the way the rest of this store is driven — the shipped actions, the
 * real service, the real fetchers, against a model of the backend, with only the
 * transport replaced. Expectations come from the world (`issuedCredentials()`)
 * and never from the store's own answer, which would agree with itself.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/** Its replacement. A named binding, for the reason the other specs give. */
const NEXT_PLAINTEXT = `${PLAINTEXT}-two`;

const SEEDED_AT = '2026-01-01T00:00:00.000Z';
const ACTOR_ID = 'stub-User-1' as UserId;

/** `example.test` is reserved by RFC 6761 and resolves for nobody. */
const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('the auth store, for account management', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands out the transport it is currently using, not the one it started with', async () => {
    const store = useAuthStore();
    const seen: string[] = [];
    const recording: ApiClient = <T>(request: ApiRequest): Promise<T> => {
      seen.push(request.path);
      return backend.client<T>(request);
    };
    store.adoptTransport(recording);
    await store.login(ACTOR.email, PLAINTEXT);
    seen.length = 0;

    await new AuthHttpService(store.authenticatedClient()).listSessions(ACTOR_ID);

    // A service built on what `authenticatedClient()` returned really does go
    // out through the transport the store was told to adopt. Comparing object
    // identity would pass for a client that was returned and never used.
    expect(seen).toEqual(['/auth/sessions']);
  });

  it('takes up the credential a password change issues', async () => {
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(ACTOR.email, PLAINTEXT);
    const before = store.accessToken;

    await store.changePassword(PLAINTEXT, NEXT_PLAINTEXT);

    // The world's last issue, not the store's own report of it.
    expect(store.accessToken).toBe(backend.issuedCredentials().at(-1));
    // This is state and not behaviour, and it is as far as this suite can go.
    // The stub resolves the actor from `ApiRequest.actor` and not from a bearer
    // credential — it has to, because the credential travels in a header that
    // `createApiClient` writes and this transport never sees — so **no spec
    // driving it can observe a stale access credential being refused**. A store
    // that dropped the reissue below goes on working here; measured, by removing
    // the line and watching a "the backend is still reachable" assertion pass.
    // What catches that in the real world is the end-to-end walk.

    // And it is a *different* one: the backend ended every session, the caller's
    // included, so a store that kept the old value is presenting a dead
    // credential and will find out one request later.
    expect(store.accessToken).not.toBe(before);
  });

  it('does NOT change the secret when the current one is refused', async () => {
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(ACTOR.email, PLAINTEXT);

    await expect(store.changePassword(NEXT_PLAINTEXT, NEXT_PLAINTEXT)).rejects.toThrow();

    expect(store.isAuthenticated).toBe(true);
    // The old secret still works, which is the assertion that says the change
    // did not half-happen. Driven through the store's own `changePassword`
    // rather than a second sign-in, so it also proves the credential the store
    // is holding is still accepted.
    await expect(store.changePassword(PLAINTEXT, NEXT_PLAINTEXT)).resolves.toBeUndefined();
  });

  it('does NOT re-send a refused secret, or rotate the session for it', async () => {
    // **The measurement this replaced an assertion about.** A refused change used
    // to cost a renewal and a second attempt: `createAuthFetch` could not tell
    // "your credential lapsed" from "that is not your current password", because
    // both are a `401`, so it renewed and retried — and the retry re-sent the
    // same body. The recorded paths for one mistyped password were
    // `['/auth/change-password', '/auth/refresh', '/auth/change-password']`.
    //
    // Two attempts for one is the damaging half: anything on the backend counting
    // failed attempts sees double, so a lockout fires after half as many tries as
    // it advertises. `createAuthFetch` now stops at a `401` the domain named.
    //
    // Counting the requests rather than watching the credential, because the
    // credential is state and this is behaviour: a version that skipped the
    // renewal and retried anyway would leave the credential untouched and still
    // be wrong.
    const seen: string[] = [];
    const store = useAuthStore();
    store.adoptTransport(<T>(request: ApiRequest): Promise<T> => {
      seen.push(request.path);
      return backend.client<T>(request);
    });
    await store.login(ACTOR.email, PLAINTEXT);
    const before = store.accessToken;
    seen.length = 0;

    await expect(store.changePassword(NEXT_PLAINTEXT, NEXT_PLAINTEXT)).rejects.toThrow();

    expect(seen.filter((path) => path === '/auth/change-password')).toHaveLength(1);
    expect(seen).not.toContain('/auth/refresh');
    expect(store.accessToken).toBe(before);
  });

  it('refuses to change a secret for nobody', async () => {
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await expect(store.changePassword(PLAINTEXT, NEXT_PLAINTEXT)).rejects.toThrow();
  });

  it('takes up a saved profile for the signed-in person', async () => {
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(ACTOR.email, PLAINTEXT);

    store.adoptProfile({ ...ACTOR, displayName: 'Ada Lovelace' });

    expect(store.currentUser?.displayName).toBe('Ada Lovelace');
  });

  it('does NOT take up somebody else', async () => {
    // `updateProfile` takes an actor and a target, so an administrator screen can
    // legitimately answer with another person's record. Adopting it would swap
    // who the application believes is signed in, and every guard downstream
    // would go on agreeing with it.
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(ACTOR.email, PLAINTEXT);

    store.adoptProfile({
      ...ACTOR,
      id: 'stub-User-999' as UserId,
      email: 'grace@example.test',
      displayName: 'Grace',
    });

    expect(store.currentUser?.displayName).toBe('Ada');
    expect(store.currentUser?.id).toBe(ACTOR_ID);
  });
});
