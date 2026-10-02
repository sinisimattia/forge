import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { AuditEntryId } from '__FORGE_SCOPE__/core/audit/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { useAudit } from '~/composables/useAudit';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';

/**
 * `useAudit`, which only reads. There is no
 * `record` test here — `~/services/organizationAudit.service.ts`'s own
 * TSDoc is where the reason lives: it must never be callable from a
 * browser.
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
const OTHER_ORG_ID = 'stub-Organization-2' as OrganizationId;
const ORG: OrganizationJSON = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('useAudit', () => {
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
    backend.putAuditEntry({
      id: 'stub-AuditEntry-1' as AuditEntryId,
      organizationId: ORG_ID,
      actorId: OWNER_ID,
      action: AuditAction.ORGANIZATION_CREATED,
      resourceType: null,
      resourceId: null,
      metadata: {},
      clientAddress: null,
      clientLabel: null,
      occurredAt: '2026-09-01T09:00:00.000Z',
    });
    // A second tenant's own entry — the tenant-isolation half of this suite:
    // reading THIS organization's audit must never surface it.
    backend.putAuditEntry({
      id: 'stub-AuditEntry-2' as AuditEntryId,
      organizationId: OTHER_ORG_ID,
      actorId: OWNER_ID,
      action: AuditAction.ORGANIZATION_CREATED,
      resourceType: null,
      resourceId: null,
      metadata: {},
      clientAddress: null,
      clientLabel: null,
      occurredAt: '2026-09-01T10:00:00.000Z',
    });
    backend.putAuditEntry({
      id: 'stub-AuditEntry-3' as AuditEntryId,
      organizationId: ORG_ID,
      actorId: OWNER_ID,
      action: AuditAction.MEMBER_INVITED,
      resourceType: null,
      resourceId: null,
      metadata: {},
      clientAddress: null,
      clientLabel: null,
      occurredAt: '2026-09-02T09:00:00.000Z',
    });
    useAuthStore().adoptTransport(backend.client);
    await useAuthStore().login(OWNER.email, PLAINTEXT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is empty with no active organization', async () => {
    const audit = useAudit();

    await audit.load();

    expect(audit.entries.value).toEqual([]);
    expect(audit.failed.value).toBe(false);
  });

  it('lists only the active organization\'s own entries, newest first', async () => {
    useOrganizationStore().setActiveOrganization(ORG_ID);
    const audit = useAudit();

    await audit.load();

    expect(audit.entries.value).toHaveLength(2);
    expect(audit.entries.value.every((entry) => entry.organizationId === ORG_ID)).toBe(true);
    expect(audit.entries.value[0]?.action).toBe(AuditAction.MEMBER_INVITED);
    expect(audit.entries.value[1]?.action).toBe(AuditAction.ORGANIZATION_CREATED);
  });
});
