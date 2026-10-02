import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  InvalidOrganizationSlugError,
  OrganizationNameRequiredError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type {
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { useInvitations } from '~/composables/useInvitations';
import { useOrganization } from '~/composables/useOrganization';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';

/**
 * `useOrganization` and `useInvitations`, the two composables that sit
 * beside `useCan` so a switcher and an invitations screen have somewhere to
 * read from other than a fetcher directly (`STANDARDS.md` W2).
 *
 * Neither holds a decision worth pinning the way `useCan`'s delegation is:
 * they list, they invite, they revoke, and re-read afterwards, the same shape
 * `useSessions` and `useIdentities` already have specs for. What is specific
 * to this pair is the one thing that is new here — reading and writing
 * `useOrganizationStore().activeOrganizationId` — and that is what these
 * tests are about.
 */

const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const ACTOR_ID = 'stub-User-1' as UserId;
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

const ORG_ID = 'stub-Organization-1' as OrganizationId;
const ORG: OrganizationJSON = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('useOrganization / useInvitations', () => {
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
    backend.putOrganization(ORG);
    backend.putMembership({
      id: 'stub-Membership-1' as MembershipId,
      organizationId: ORG_ID,
      userId: ACTOR_ID,
      role: OrgRole.OWNER,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists the organizations the signed-in actor belongs to', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    const organization = useOrganization();

    await organization.load();

    expect(organization.organizations.value).toHaveLength(1);
    expect(organization.organizations.value[0]?.id).toBe(ORG_ID);
    expect(organization.failed.value).toBe(false);
  });

  it('sets the active organization on the shared store, not on its own state', () => {
    const organization = useOrganization();

    organization.setActive(ORG_ID);

    expect(useOrganizationStore().activeOrganizationId).toBe(ORG_ID);
    expect(organization.activeOrganizationId.value).toBe(ORG_ID);
  });

  it('reads the active membership off the hydrated principal, not off the organization list', () => {
    const orgStore = useOrganizationStore();
    orgStore.principal = {
      userId: ACTOR_ID,
      platformRole: PlatformRole.PLATFORM_USER,
      memberships: [{ organizationId: ORG_ID, role: OrgRole.OWNER }],
      grants: [],
    };
    const organization = useOrganization();

    expect(organization.activeMembership.value).toBeNull();
    organization.setActive(ORG_ID);
    expect(organization.activeMembership.value).toEqual({
      organizationId: ORG_ID,
      role: OrgRole.OWNER,
    });
  });

  it('is empty with no active organization', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    const invitations = useInvitations();

    await invitations.load();

    expect(invitations.invitations.value).toEqual([]);
    expect(invitations.failed.value).toBe(false);
  });

  it('invites into the active organization, and re-reads the list', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const invitations = useInvitations();

    await invitations.invite('invitee@example.test', OrgRole.MEMBER);

    expect(invitations.failed.value).toBe(false);
    expect(invitations.invitations.value).toHaveLength(1);
    expect(invitations.invitations.value[0]?.email).toBe('invitee@example.test');
  });

  it('revokes an open invitation, and re-reads the list', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const invitations = useInvitations();
    await invitations.invite('invitee@example.test', OrgRole.MEMBER);
    const invitationId = invitations.invitations.value[0]?.id;
    if (invitationId === undefined) throw new Error('setup did not create an invitation');

    await invitations.revoke(invitationId);

    expect(invitations.failed.value).toBe(false);
    expect(invitations.invitations.value).toEqual([]);
  });

  it('reads the open invitations by default and the asked-for status when given one', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const invitations = useInvitations();
    await invitations.invite('invitee@example.test', OrgRole.MEMBER);
    const invitationId = invitations.invitations.value[0]?.id;
    if (invitationId === undefined) throw new Error('setup did not create an invitation');
    await invitations.revoke(invitationId);

    await invitations.load();
    expect(invitations.invitations.value).toEqual([]);

    await invitations.load(InvitationStatus.REVOKED);
    expect(invitations.invitations.value.map((one) => one.id)).toEqual([invitationId]);
  });

  it('finds the active organization\'s own record among the list, not by a second request', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    const organization = useOrganization();

    expect(organization.activeOrganization.value).toBeNull();
    await organization.load();
    expect(organization.activeOrganization.value).toBeNull();
    organization.setActive(ORG_ID);
    expect(organization.activeOrganization.value?.id).toBe(ORG_ID);
  });

  it('creates an organization with the actor as its owner, and lists it afterward', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    const organization = useOrganization();
    await organization.load();
    expect(organization.organizations.value).toHaveLength(1);

    const created = await organization.create('Northwind Traders', 'northwind-traders');

    expect(created.slug).toBe('northwind-traders');
    expect(organization.organizations.value).toHaveLength(2);
  });

  it('rethrows the domain refusal rather than swallowing it into a flag', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    const organization = useOrganization();

    await expect(organization.create('', 'a-slug')).rejects.toBeInstanceOf(
      OrganizationNameRequiredError,
    );
    await expect(organization.create('A Name', 'Not A Slug!')).rejects.toBeInstanceOf(
      InvalidOrganizationSlugError,
    );
  });

  it('updates the organization\'s own name and slug, and re-reads the list', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    const organization = useOrganization();
    await organization.load();

    await organization.update(ORG_ID, { name: 'Acme Renamed', slug: 'acme-renamed' });

    expect(organization.organizations.value[0]?.name).toBe('Acme Renamed');
    expect(organization.organizations.value[0]?.slug).toBe('acme-renamed');
  });

  it('removes an organization, and it no longer lists', async () => {
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(ACTOR.email, PLAINTEXT);
    const organization = useOrganization();
    await organization.load();
    expect(organization.organizations.value).toHaveLength(1);

    await organization.remove(ORG_ID);

    expect(organization.organizations.value).toEqual([]);
  });

  it('accepts an invitation by its token, with no organization known ahead of time', async () => {
    const invitee: UserJSON = {
      ...ACTOR,
      id: 'stub-User-2' as UserId,
      email: 'invitee@example.test',
    };
    backend.putUser(invitee, PLAINTEXT);
    const owner = useAuthStore();
    owner.adoptTransport(backend.client);
    await owner.login(ACTOR.email, PLAINTEXT);
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const invitations = useInvitations();
    await invitations.invite(invitee.email, OrgRole.MEMBER);
    const invitationId = invitations.invitations.value[0]?.id;
    if (invitationId === undefined) throw new Error('setup did not create an invitation');
    const token = backend.tokenForInvitation(invitationId);

    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.adoptTransport(backend.client);
    await auth.login(invitee.email, PLAINTEXT);
    const organization = useOrganization();

    const membership = await organization.acceptInvitation(token);

    expect(membership.organizationId).toBe(ORG_ID);
    expect(membership.userId).toBe(invitee.id);
    await organization.load();
    expect(organization.organizations.value).toHaveLength(1);
  });
});
