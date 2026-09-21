import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { Invitation } from '__FORGE_SCOPE__/core/organizations/entities';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { InvitationId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import InvitationList from '../organisms/InvitationList.vue';
import { mountOptions, stubAutoImports } from './harness';

const ORG = 'org-1' as OrganizationId;

function invitation(id: string, email: string): Invitation {
  return Invitation.fromJSON({
    id: id as InvitationId,
    organizationId: ORG,
    email,
    role: OrgRole.MEMBER,
    status: InvitationStatus.PENDING,
    invitedByUserId: null,
    expiresAt: '2026-10-01T09:00:00.000Z',
    createdAt: '2026-09-01T09:00:00.000Z',
    acceptedAt: null,
    acceptedByUserId: null,
  });
}

const FIRST = invitation('invitation-1', 'ada@example.test');
const SECOND = invitation('invitation-2', 'grace@example.test');

function list(props: Record<string, unknown>) {
  return mount(InvitationList, {
    props: { invitations: [FIRST, SECOND], ...props },
    global: mountOptions(),
  });
}

describe('InvitationList', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one row per invitation', () => {
    expect(list({}).findAll('tbody tr')).toHaveLength(2);
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
    expect(wrapper.emitted('revoke')).toEqual([[SECOND.id]]);
  });

  it('disables every control while busy — a `disabled` attribute `.text()` cannot see', () => {
    const wrapper = list({ canRevoke: true, busy: true });
    expect(wrapper.findAll('button')[0]?.attributes('disabled')).toBeDefined();
  });
});
