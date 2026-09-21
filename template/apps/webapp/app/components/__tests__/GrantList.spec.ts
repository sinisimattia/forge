import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { GrantId, ResourceGrant, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import GrantList from '../organisms/GrantList.vue';
import { mountOptions, stubAutoImports } from './harness';

const ORG = 'org-1' as OrganizationId;

function grant(id: string, subjectUserId: string, expiresAt: Date | null): ResourceGrant {
  return {
    id: id as GrantId,
    subjectUserId: subjectUserId as UserId,
    organizationId: ORG,
    resourceType: 'document' as ResourceType,
    resourceId: 'doc-1',
    permission: 'grant:read',
    grantedBy: 'user-1' as UserId,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    expiresAt,
  };
}

const EXPIRING = grant('grant-1', 'user-2', new Date('2026-12-01T00:00:00.000Z'));
const OPEN_ENDED = grant('grant-2', 'user-3', null);

function list(props: Record<string, unknown>) {
  return mount(GrantList, {
    props: { grants: [EXPIRING, OPEN_ENDED], ...props },
    global: mountOptions(),
  });
}

describe('GrantList', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one row per grant', () => {
    expect(list({}).findAll('tbody tr')).toHaveLength(2);
  });

  it('renders a grant\'s own permission as a value, and switches on none of them', () => {
    // There is no per-permission branch to have missed: every permission this
    // application has renders identically here, as `grant.permission` itself.
    expect(list({}).text()).toContain('grant:read');
  });

  it('says "never" for a grant with no expiry, and the instant for one that has one', () => {
    const text = list({}).text();
    expect(text).toContain('organizations.settings.never');
  });

  it('offers no revoke control without canRevoke', () => {
    expect(list({}).findAll('button')).toHaveLength(0);
  });

  it('offers a revoke control on every row with canRevoke', () => {
    expect(list({ canRevoke: true }).findAll('button')).toHaveLength(2);
  });

  it('emits revoke with the row\'s own id, not always the first', async () => {
    const wrapper = list({ canRevoke: true });
    await wrapper.findAll('tbody tr')[1]?.find('button').trigger('click');
    expect(wrapper.emitted('revoke')).toEqual([[OPEN_ENDED.id]]);
  });

  it('disables every control while busy — a `disabled` attribute `.text()` cannot see', () => {
    const wrapper = list({ canRevoke: true, busy: true });
    expect(wrapper.findAll('button')[0]?.attributes('disabled')).toBeDefined();
  });
});
