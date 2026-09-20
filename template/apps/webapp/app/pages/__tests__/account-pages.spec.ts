import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { mountOptions, stubAutoImports } from '~/components/__tests__/harness';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import ProfilePage from '../account/profile.vue';
import SecurityPage from '../account/security.vue';

/**
 * The two account pages that hold a decision.
 *
 * `sessions.vue` and `identities.vue` deliberately have no spec of their own:
 * every decision in them belongs to something that does have one. They call
 * `load()` on mount, hand the list to an organism, and pass an emit back to the
 * composable — the failure, empty and last-identity branches are
 * `useSessions`/`useIdentities`', the row, badge and control branches are
 * `SessionList`/`IdentityList`', and both of those are injected and watched
 * failing. There is nothing left in the page that could be wrong on its own.
 * These two are different: each maps several distinct refusals onto several
 * distinct messages, in the page, and nothing else can see that mapping.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';
const NEXT_PLAINTEXT = `${PLAINTEXT}-two`;
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** `example.test` is reserved by RFC 6761 and resolves for nobody. */
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

describe('the account pages', () => {
  let backend: StubBackend;

  beforeEach(async () => {
    stubAutoImports();
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(ACTOR.email, PLAINTEXT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('security', () => {
    /** Fills both fields and submits. */
    async function change(current: string, next: string) {
      const wrapper = mount(SecurityPage, { global: mountOptions() });
      await wrapper.find('#security-current').setValue(current);
      await wrapper.find('#security-new').setValue(next);
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      return wrapper;
    }

    it('says every other session has ended, before the person commits to it', () => {
      // The change signs the person out everywhere else. That is the point of it
      // and it is invisible from here, so a phone in another room asking for a
      // password again reads as a fault unless the page said so first.
      const wrapper = mount(SecurityPage, { global: mountOptions() });
      expect(wrapper.text()).toContain('account.security.endsOtherSessions');
    });

    it('names a wrong current password, and that is not an enumeration risk here', async () => {
      // Whoever is on this page has already proved they hold the account, so
      // naming this refusal tells them something only they can act on and tells a
      // stranger nothing. It is the one refusal in the application that is
      // allowed to be specific.
      const wrapper = await change(NEXT_PLAINTEXT, NEXT_PLAINTEXT);
      expect(wrapper.text()).toContain('account.security.wrongCurrent');
    });

    it('does NOT say the same thing when it is the new secret that was refused', async () => {
      const wrapper = await change(PLAINTEXT, 'short');
      expect(wrapper.text()).toContain('auth.passwordRules.tooShort');
      expect(wrapper.text()).not.toContain('account.security.wrongCurrent');
      expect(wrapper.text()).not.toContain('account.security.failed');
    });

    it('does NOT say either when it simply could not ask', async () => {
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));
      const wrapper = await change(PLAINTEXT, NEXT_PLAINTEXT);
      expect(wrapper.text()).toContain('account.security.failed');
      expect(wrapper.text()).not.toContain('account.security.wrongCurrent');
      expect(wrapper.text()).not.toContain('account.security.changed');
    });

    it('confirms a change that worked, and empties the fields', async () => {
      const wrapper = await change(PLAINTEXT, NEXT_PLAINTEXT);
      expect(wrapper.text()).toContain('account.security.changed');
      // Left populated, a page that is still on screen holds two secrets in the
      // DOM, one of which is now live.
      expect((wrapper.find('#security-current').element as HTMLInputElement).value).toBe('');
      expect((wrapper.find('#security-new').element as HTMLInputElement).value).toBe('');
    });

    it('does NOT confirm anything before it is asked', () => {
      const wrapper = mount(SecurityPage, { global: mountOptions() });
      expect(wrapper.text()).not.toContain('account.security.changed');
      expect(wrapper.text()).not.toContain('account.security.wrongCurrent');
      expect(wrapper.text()).not.toContain('account.security.failed');
    });
  });

  describe('profile', () => {
    it('opens on the name the person already has', () => {
      const wrapper = mount(ProfilePage, { global: mountOptions() });
      expect((wrapper.find('#profile-name').element as HTMLInputElement).value).toBe('Ada');
    });

    it('fills the field once the renewal answers, having opened blank', async () => {
      // A full page load starts with nobody signed in — the credential lives in
      // memory only, so `status` is `unknown` until the renewal resolves. A page
      // that read `currentUser` once at setup would open blank for every visitor
      // who arrived by refreshing, and stay blank.
      setActivePinia(createPinia());
      const store = useAuthStore();
      store.adoptTransport(backend.client);

      const wrapper = mount(ProfilePage, { global: mountOptions() });
      expect((wrapper.find('#profile-name').element as HTMLInputElement).value).toBe('');

      await store.login(ACTOR.email, PLAINTEXT);
      await flushPromises();

      expect((wrapper.find('#profile-name').element as HTMLInputElement).value).toBe('Ada');
    });

    it('saves a new name, and the application believes it immediately', async () => {
      // The second half is the part that is easy to leave out: the header, the
      // menu and the avatar all read the store, so a save that only told the
      // server leaves the old name on screen until the next full page load.
      const wrapper = mount(ProfilePage, { global: mountOptions() });
      await wrapper.find('#profile-name').setValue('Ada Lovelace');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('account.profile.saved');
      expect(useAuthStore().currentUser?.displayName).toBe('Ada Lovelace');
    });

    it('does NOT report success, or change the application, when the name is refused', async () => {
      const wrapper = mount(ProfilePage, { global: mountOptions() });
      await wrapper.find('#profile-name').setValue('   ');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('account.profile.nameRequired');
      expect(wrapper.text()).not.toContain('account.profile.saved');
      expect(useAuthStore().currentUser?.displayName).toBe('Ada');
    });

    it('does NOT blame the name when it could not ask at all', async () => {
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));
      const wrapper = mount(ProfilePage, { global: mountOptions() });
      await wrapper.find('#profile-name').setValue('Ada Lovelace');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('account.profile.failed');
      expect(wrapper.text()).not.toContain('account.profile.nameRequired');
    });

    it('shows the address, and offers no way to change it', () => {
      // Changing an address means proving the new one, which is a different act
      // with a different endpoint and is not shipped. A disabled input would say
      // the ability exists and is switched off.
      const wrapper = mount(ProfilePage, { global: mountOptions() });
      expect(wrapper.text()).toContain(ACTOR.email);
      expect(wrapper.findAll('input[type="email"]')).toHaveLength(0);
    });
  });
});
