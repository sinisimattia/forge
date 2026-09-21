import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  InvitationId,
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { mountOptions, navigations, route, stubAutoImports } from '~/components/__tests__/harness';
import { useInvitations } from '~/composables/useInvitations';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';
import AcceptInvitationPage from '../invitations/[token].vue';
import OrganizationSettingsPage from '../organizations/[organizationId]/settings.vue';
import OrganizationsIndexPage from '../organizations/index.vue';

/**
 * The three organization pages that hold a decision of their own —
 * `organizations/index.vue`, `[organizationId]/settings.vue` and
 * `invitations/[token].vue` — the same reasoning `account-pages.spec.ts`
 * gives for choosing exactly these three among the six this task ships:
 * `members.vue`, `invitations.vue` and `audit.vue` map a list straight onto
 * an organism with no branch of their own, and their branches are
 * `MemberList`'s, `InvitationList`'s, `GrantList`'s and the composables'.
 */

const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const OWNER_ID = 'stub-User-1' as UserId;
const OWNER: UserJSON = {
  id: OWNER_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

const ORG_ID = 'stub-Organization-1' as OrganizationId;
const ORG: OrganizationJSON = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('the organization pages', () => {
  let backend: StubBackend;

  beforeEach(async () => {
    stubAutoImports();
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(OWNER, PLAINTEXT);
    backend.putOrganization(ORG);
    backend.putMembership({
      id: 'stub-Membership-1' as MembershipId,
      organizationId: ORG_ID,
      userId: OWNER_ID,
      role: OrgRole.OWNER,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    const store = useAuthStore();
    store.adoptTransport(backend.client);
    await store.login(OWNER.email, PLAINTEXT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('organizations/index.vue', () => {
    it('lists the organizations the actor belongs to, once mounted', async () => {
      const wrapper = mount(OrganizationsIndexPage, { global: mountOptions() });
      await flushPromises();
      expect(wrapper.text()).toContain('Acme');
    });

    it('names the missing field, and creates nothing, on a blank name', async () => {
      const wrapper = mount(OrganizationsIndexPage, { global: mountOptions() });
      await flushPromises();
      await wrapper.find('#organization-slug').setValue('northwind');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('organizations.nameRequired');
      expect(wrapper.text()).not.toContain('Northwind');
    });

    it('names the slug, and creates nothing, on an unusable one', async () => {
      const wrapper = mount(OrganizationsIndexPage, { global: mountOptions() });
      await flushPromises();
      await wrapper.find('#organization-name').setValue('Northwind');
      await wrapper.find('#organization-slug').setValue('Not A Slug!');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('organizations.invalidSlug');
      // Paired with its opposite, per `account-pages.spec.ts`'s own pattern:
      // an implementation naming every refusal identically would pass the
      // assertion above alone.
      expect(wrapper.text()).not.toContain('organizations.nameRequired');
    });

    it('creates an organization on a valid submission, and clears the form', async () => {
      const wrapper = mount(OrganizationsIndexPage, { global: mountOptions() });
      await flushPromises();
      await wrapper.find('#organization-name').setValue('Northwind');
      await wrapper.find('#organization-slug').setValue('northwind');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('organizations.created');
      expect((wrapper.find('#organization-name').element as HTMLInputElement).value).toBe('');
      expect(wrapper.text()).toContain('Northwind');
    });
  });

  describe('[organizationId]/settings.vue', () => {
    beforeEach(() => {
      route.params = { organizationId: ORG_ID };
    });

    function mountSettings() {
      return mount(OrganizationSettingsPage, { global: mountOptions() });
    }

    it('opens on the organization\'s own current name and slug', async () => {
      const wrapper = mountSettings();
      await flushPromises();
      expect((wrapper.find('#organization-settings-name').element as HTMLInputElement).value)
        .toBe('Acme');
      expect((wrapper.find('#organization-settings-slug').element as HTMLInputElement).value)
        .toBe('acme');
    });

    it('saves a change, and the list believes it immediately', async () => {
      const wrapper = mountSettings();
      await flushPromises();
      await wrapper.find('#organization-settings-name').setValue('Acme Renamed');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('organizations.settings.saved');
      expect((wrapper.find('#organization-settings-name').element as HTMLInputElement).value)
        .toBe('Acme Renamed');
    });

    it('does NOT offer to delete the organization without organization:delete', async () => {
      // `useOrganizationStore().principal` starts `null`, exactly as it would
      // on any full page load nothing has hydrated yet — the safe, refusing
      // direction `useCan`'s own TSDoc names. The delete card must stay
      // absent, not merely unclicked.
      const wrapper = mountSettings();
      await flushPromises();
      expect(wrapper.text()).not.toContain('organizations.settings.deleteTitle');
    });

    it('offers to delete the organization once the principal says OWNER', async () => {
      useOrganizationStore().principal = {
        userId: OWNER_ID,
        platformRole: PlatformRole.PLATFORM_USER,
        memberships: [{ organizationId: ORG_ID, role: OrgRole.OWNER }],
        grants: [],
      };
      const wrapper = mountSettings();
      await flushPromises();

      expect(wrapper.text()).toContain('organizations.settings.deleteTitle');
    });

    it('deletes the organization through the confirm dialog, and navigates away', async () => {
      useOrganizationStore().principal = {
        userId: OWNER_ID,
        platformRole: PlatformRole.PLATFORM_USER,
        memberships: [{ organizationId: ORG_ID, role: OrgRole.OWNER }],
        grants: [],
      };
      const wrapper = mountSettings();
      await flushPromises();
      const openTrigger = wrapper.findAll('button')
        .find((button) => button.text() === 'organizations.settings.delete');
      if (openTrigger === undefined) throw new Error('the delete trigger did not render');
      await openTrigger.trigger('click');
      await flushPromises();

      // `ConfirmDialog` teleports to `document.body`, outside `wrapper`'s own
      // tree — `AppOverlay`'s own TSDoc explains why (`Teleport to="body"`).
      expect(document.body.textContent).toContain('organizations.settings.deleteConfirmTitle');
      const dialogButtons = [...document.body.querySelectorAll('button')];
      const confirmButton = dialogButtons.find((button) => button.textContent?.trim()
        === 'organizations.settings.delete');
      if (confirmButton === undefined) throw new Error('the dialog\'s own confirm button did not render');
      confirmButton.dispatchEvent(new Event('click', { bubbles: true }));
      await flushPromises();

      expect(navigations).toContain('/organizations');
      wrapper.unmount();
    });
  });

  describe('invitations/[token].vue', () => {
    it('accepts a valid invitation, and lands on that organization\'s own members screen', async () => {
      const invitee: UserJSON = { ...OWNER, id: 'stub-User-2' as UserId, email: 'invitee@example.test' };
      backend.putUser(invitee, PLAINTEXT);
      useOrganizationStore().setActiveOrganization(ORG_ID);
      const { invite, invitations: invited } = useInvitations();
      await invite(invitee.email, OrgRole.MEMBER);
      const invitationId = invited.value[0]?.id as InvitationId;
      const token = backend.tokenForInvitation(invitationId);

      setActivePinia(createPinia());
      const auth = useAuthStore();
      auth.adoptTransport(backend.client);
      await auth.login(invitee.email, PLAINTEXT);
      route.params = { token };
      const wrapper = mount(AcceptInvitationPage, { global: mountOptions() });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(navigations).toContain(`/organizations/${ORG_ID}/members`);
    });

    it('names the refusal when the token names nothing', async () => {
      const unminted = 'no-such-token';
      route.params = { token: unminted };
      const wrapper = mount(AcceptInvitationPage, { global: mountOptions() });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('organizations.acceptInvitation.notFound');
    });
  });
});
