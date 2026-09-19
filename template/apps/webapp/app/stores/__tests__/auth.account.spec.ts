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
    // And it is a *different* one: the backend ended every session, the caller's
    // included, so a store that kept the old value is presenting a dead
    // credential and will find out one request later.
    expect(store.accessToken).not.toBe(before);
  });

  it('is still able to reach the backend afterwards', async () => {
    // The assertion the one above cannot make: that the value it took up is the
    // one the server now accepts. A store that stored some other string would
    // satisfy neither, but a store that stored the right string and failed to
    // hand it to the transport would satisfy the first.
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(ACTOR.email, PLAINTEXT);

    await store.changePassword(PLAINTEXT, NEXT_PLAINTEXT);

    await expect(
      new AuthHttpService(store.authenticatedClient()).listSessions(ACTOR_ID),
    ).resolves.toHaveLength(1);
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

  it('is left holding the world\'s current credential after a refused change', async () => {
    // A refused change **rotates the session**, and the store must keep up.
    //
    // `createAuthFetch` cannot tell "your credential lapsed" from "that is not
    // your current password": both are a bare `401` with no code, by the
    // backend's design. It therefore renews once and retries — a cost its own
    // documentation names. What that documentation does not say, and what this
    // assertion pins, is the consequence for the store: the renewal issues a new
    // credential, and a store that did not take it up would be presenting a
    // spent one on the next request, having done nothing but mistype a password.
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(ACTOR.email, PLAINTEXT);
    const before = store.accessToken;

    await expect(store.changePassword(NEXT_PLAINTEXT, NEXT_PLAINTEXT)).rejects.toThrow();

    expect(store.accessToken).toBe(backend.issuedCredentials().at(-1));
    expect(store.accessToken).not.toBe(before);
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
