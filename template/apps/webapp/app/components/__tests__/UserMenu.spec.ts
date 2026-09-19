import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import type { ApiClient, ApiRequest } from '~/types';
import UserMenu from '../molecules/UserMenu.vue';
import { mountOptions, navigations, stubAutoImports } from './harness';

/**
 * Two things this component was adapted for, each with its own assertion.
 *
 * It arrived reading `firstName`/`lastName`, which this domain's `User` does not
 * have, and calling `logout()` without awaiting it — which this application's
 * `logout` cannot tolerate, because it clears the local session in a `finally`
 * and then **re-throws**. Unhandled, that rejection surfaces as an error to
 * somebody who has in fact been signed out.
 *
 * The second is pinned by observing where the person ends up: if the rejection
 * escaped, the navigation after it never happens.
 */
const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

function person(displayName: string): UserJSON {
  return {
    id: 'stub-User-1' as UserId,
    // `example.test` is reserved by RFC 6761 and resolves for nobody.
    email: 'ada@example.test',
    displayName,
    status: UserStatus.ACTIVE,
    platformRole: PlatformRole.PLATFORM_USER,
    emailVerifiedAt: SEEDED_AT,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    deletedAt: null,
  };
}

describe('UserMenu', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubAutoImports();
    setActivePinia(createPinia());
    backend = stubBackend();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Puts the world's one account in place and signs in as it. */
  async function signedInAs(displayName: string): Promise<void> {
    const account = person(displayName);
    backend.putUser(account, PLAINTEXT);
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(account.email, PLAINTEXT);
  }

  it('derives the initials from the display name', async () => {
    await signedInAs('Ada Lovelace');
    expect(mount(UserMenu, { global: mountOptions() }).text()).toContain('AL');
  });

  it('derives them from a one-word display name too', async () => {
    // `displayName` is one free-text field, so it is one word as often as two.
    // A component splitting it into first and last would produce nothing here.
    await signedInAs('Ada');
    const text = mount(UserMenu, { global: mountOptions() }).text();
    expect(text).toContain('A');
    expect(text).not.toContain('undefined');
  });

  it('does NOT claim initials for somebody it has not been told about', () => {
    // Before the renewal answers, nobody is known. A component that rendered
    // letters here would be rendering them from nothing.
    expect(mount(UserMenu, { global: mountOptions() }).text()).toContain('?');
  });

  it('does NOT show the menu until it is opened', async () => {
    await signedInAs('Ada Lovelace');
    const wrapper = mount(UserMenu, { global: mountOptions() });
    expect(wrapper.text()).not.toContain('common.nav.signOut');
    await wrapper.find('button').trigger('click');
    expect(wrapper.text()).toContain('common.nav.signOut');
  });

  it('signs out and goes somewhere a signed-out person may be', async () => {
    await signedInAs('Ada Lovelace');
    const wrapper = mount(UserMenu, { global: mountOptions() });
    await wrapper.find('button').trigger('click');
    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(useAuthStore().isAuthenticated).toBe(false);
    expect(navigations).toEqual(['/']);
  });

  it('still does both when the server cannot be told', async () => {
    // `logout` clears the local session in a `finally` and re-throws, because a
    // session the backend still holds is something whoever asked to end it is
    // owed. The menu has to catch it: if it does not, the navigation below never
    // happens and the person is left on a page they can no longer load, beside
    // an error, while actually signed out.
    await signedInAs('Ada Lovelace');
    const refusing: ApiClient = <T>(request: ApiRequest): Promise<T> => (
      request.path.endsWith('/logout')
        ? Promise.reject(new Error('the backend is not there'))
        : backend.client<T>(request)
    );
    useAuthStore().adoptTransport(refusing);

    const wrapper = mount(UserMenu, { global: mountOptions() });
    await wrapper.find('button').trigger('click');
    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(useAuthStore().isAuthenticated).toBe(false);
    expect(navigations).toEqual(['/']);
  });
});
