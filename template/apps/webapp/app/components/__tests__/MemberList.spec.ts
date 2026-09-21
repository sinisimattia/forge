import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { Membership } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { MembershipId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import MemberList from '../organisms/MemberList.vue';
import { mountOptions, stubAutoImports } from './harness';

const ORG = 'org-1' as OrganizationId;

function membership(id: string, userId: string, role: OrgRole): Membership {
  return Membership.fromJSON({
    id: id as MembershipId,
    organizationId: ORG,
    userId: userId as UserId,
    role,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  });
}

const OWNER = membership('membership-1', 'user-1', OrgRole.OWNER);
const MEMBER = membership('membership-2', 'user-2', OrgRole.MEMBER);

function list(props: Record<string, unknown>) {
  return mount(MemberList, {
    props: { members: [OWNER, MEMBER], ...props },
    global: mountOptions(),
  });
}

describe('MemberList', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one row per member', () => {
    expect(list({}).findAll('tbody tr')).toHaveLength(2);
  });

  it('shows a role as text, and offers no control, without either permission', () => {
    const wrapper = list({});
    // `.html()`, not `.text()`: a `<select>` and a `<span>` can render the same
    // label text, and the differentiator here is which element is present, not
    // what it says.
    expect(wrapper.html()).not.toContain('<select');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('offers a role select only with canChangeRole, independent of canRemove', () => {
    const wrapper = list({ canChangeRole: true });
    expect(wrapper.html()).toContain('<select');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('offers a remove button only with canRemove, independent of canChangeRole', () => {
    const wrapper = list({ canRemove: true });
    expect(wrapper.html()).not.toContain('<select');
    expect(wrapper.findAll('button')).toHaveLength(2);
  });

  it('emits updateRole with the row\'s own userId', async () => {
    const wrapper = list({ canChangeRole: true });
    await wrapper.findAll('select')[1]?.setValue(OrgRole.ADMIN);
    expect(wrapper.emitted('updateRole')).toEqual([[MEMBER.userId, OrgRole.ADMIN]]);
  });

  it('emits remove with the row\'s own userId', async () => {
    const wrapper = list({ canRemove: true });
    await wrapper.findAll('button')[1]?.trigger('click');
    expect(wrapper.emitted('remove')).toEqual([[MEMBER.userId]]);
  });

  it('disables every control while busy — a `disabled` attribute `.text()` cannot see', () => {
    const wrapper = list({ canChangeRole: true, canRemove: true, busy: true });
    expect(wrapper.findAll('select')[0]?.attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('button')[0]?.attributes('disabled')).toBeDefined();
  });
});
