import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { useMembers } from '~/composables/useMembers';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';

/**
 * `useMembers`, the composable a members screen reads from rather than
 * `OrganizationHttpService` directly (`STANDARDS.md` W2). Its own shape is
 * `useInvitations`', so what these tests pin is specific to it: two members,
 * and the two verbs that act on one of them by id rather than by position.
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

const MEMBER_ID = 'stub-User-2' as UserId;

const ORG_ID = 'stub-Organization-1' as OrganizationId;
const ORG: OrganizationJSON = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('useMembers', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
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
    backend.putMembership({
      id: 'stub-Membership-2' as MembershipId,
      organizationId: ORG_ID,
      userId: MEMBER_ID,
      role: OrgRole.MEMBER,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    useAuthStore().adoptTransport(backend.client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is empty with no active organization', async () => {
    await useAuthStore().login(OWNER.email, PLAINTEXT);
    const members = useMembers();

    await members.load();

    expect(members.members.value).toEqual([]);
    expect(members.failed.value).toBe(false);
  });

  it('lists the active organization\'s members', async () => {
    await useAuthStore().login(OWNER.email, PLAINTEXT);
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const members = useMembers();

    await members.load();

    expect(members.members.value).toHaveLength(2);
    expect(members.failed.value).toBe(false);
  });

  it('changes the named member\'s role, not the first one\'s, and re-reads the list', async () => {
    await useAuthStore().login(OWNER.email, PLAINTEXT);
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const members = useMembers();
    await members.load();

    await members.updateRole(MEMBER_ID, OrgRole.ADMIN);

    const changed = members.members.value.find((one) => one.userId === MEMBER_ID);
    expect(changed?.role).toBe(OrgRole.ADMIN);
    const owner = members.members.value.find((one) => one.userId === OWNER_ID);
    expect(owner?.role).toBe(OrgRole.OWNER);
    expect(members.failed.value).toBe(false);
  });

  it('removes the named member, not the first one, and re-reads the list', async () => {
    await useAuthStore().login(OWNER.email, PLAINTEXT);
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const members = useMembers();
    await members.load();

    await members.remove(MEMBER_ID);

    expect(members.members.value).toHaveLength(1);
    expect(members.members.value[0]?.userId).toBe(OWNER_ID);
    expect(members.failed.value).toBe(false);
  });
});
