import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { useGrants } from '~/composables/useGrants';
import { AuthorizationHttpService } from '~/services';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';

/**
 * `useGrants`. There is no test here for issuing one, because there is no
 * `create` to test — see the composable's own TSDoc for why the webapp has
 * no grant-creation form, and no `Permission` dropdown to feed one.
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

const SUBJECT_ID = 'stub-User-2' as UserId;

const ORG_ID = 'stub-Organization-1' as OrganizationId;
const ORG: OrganizationJSON = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('useGrants', () => {
  let backend: StubBackend;

  beforeEach(async () => {
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
      userId: SUBJECT_ID,
      role: OrgRole.MEMBER,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    useAuthStore().adoptTransport(backend.client);
    await useAuthStore().login(OWNER.email, PLAINTEXT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is empty with no active organization', async () => {
    const grants = useGrants();

    await grants.load();

    expect(grants.grants.value).toEqual([]);
    expect(grants.failed.value).toBe(false);
  });

  it('lists the active organization\'s grants', async () => {
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const service = new AuthorizationHttpService(useAuthStore().authenticatedClient());
    await service.createGrant(OWNER_ID, ORG_ID, {
      subjectUserId: SUBJECT_ID,
      resourceType: 'document' as ResourceType,
      resourceId: 'doc-1',
      permission: 'grant:read',
    });
    const grants = useGrants();

    await grants.load();

    expect(grants.grants.value).toHaveLength(1);
    expect(grants.grants.value[0]?.subjectUserId).toBe(SUBJECT_ID);
  });

  it('revokes the named grant, not the first one, and re-reads the list', async () => {
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const service = new AuthorizationHttpService(useAuthStore().authenticatedClient());
    const first = await service.createGrant(OWNER_ID, ORG_ID, {
      subjectUserId: SUBJECT_ID,
      resourceType: 'document' as ResourceType,
      resourceId: 'doc-1',
      permission: 'grant:read',
    });
    const second = await service.createGrant(OWNER_ID, ORG_ID, {
      subjectUserId: SUBJECT_ID,
      resourceType: 'document' as ResourceType,
      resourceId: 'doc-2',
      permission: 'grant:read',
    });
    const grants = useGrants();
    await grants.load();

    await grants.revoke(first.id);

    expect(grants.grants.value).toHaveLength(1);
    expect(grants.grants.value[0]?.id).toBe(second.id);
    expect(grants.failed.value).toBe(false);
  });
});
