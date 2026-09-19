import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import { useAuth } from '~/composables/useAuth';
import { useCurrentUser } from '~/composables/useCurrentUser';
import { useAuthStore } from '~/stores/auth';

/**
 * The third link of W2's chain — fetcher → service → composable → component —
 * and the only one a component may call.
 *
 * What is worth asserting about a composable this thin is not that it returns
 * the right fields. It is the property that makes it a composable **over a
 * store** rather than one that owns its own `ref`: two callers see one person.
 * A composable holding its own state passes every other test in this file and
 * fails that one, and the symptom is a header showing somebody who has signed
 * out.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

const SEEDED_AT = '2026-01-01T00:00:00.000Z';

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

describe('useAuth / useCurrentUser', () => {
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
    useAuthStore().adoptTransport(backend.client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports nobody before anybody has signed in', () => {
    const auth = useAuth();

    expect(auth.currentUser.value).toBeNull();
    expect(auth.isAuthenticated.value).toBe(false);
    expect(auth.status.value).toBe('unknown');
  });

  it('signs in through the composable and reports who it was', async () => {
    const auth = useAuth();

    const outcome = await auth.login(ACTOR.email, PLAINTEXT);

    expect(outcome.status).toBe(AuthenticationStatus.AUTHENTICATED);
    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.status.value).toBe('authenticated');
    expect(auth.currentUser.value?.email).toBe(ACTOR.email);
  });

  // The claim that makes this a store. Two components, two calls, one person —
  // and when one of them signs out, the other one knows.
  it('shows every caller the same person', async () => {
    const header = useAuth();
    const sidebar = useCurrentUser();

    await header.login(ACTOR.email, PLAINTEXT);
    expect(sidebar.value?.id).toBe(ACTOR.id);

    await header.logout();
    expect(sidebar.value).toBeNull();
    expect(header.isAuthenticated.value).toBe(false);
  });

  // The narrower surface is the point of the composable existing at all: a
  // component has no business renewing a session, replacing the transport, or
  // reaching for the transport to build a service of its own.
  //
  // `changePassword` joined the list when the account pages landed, and it
  // belongs on this side of the line for one reason: it rotates the credential
  // the whole application presents, so only the store can perform it and a
  // component still has to be able to ask. The list is spelled out rather than
  // counted so that a member added without thought fails here — which is what it
  // did when `changePassword` was added.
  it('offers a component nothing but the three verbs', () => {
    expect(Object.keys(useAuth()).sort()).toEqual([
      'changePassword',
      'currentUser',
      'isAuthenticated',
      'login',
      'logout',
      'status',
    ]);
  });
});
