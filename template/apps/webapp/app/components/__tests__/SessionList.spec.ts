import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { OwnSession } from '~/types';
import SessionList from '../organisms/SessionList.vue';
import { mountOptions, stubAutoImports } from './harness';

const OWNER = 'user-1' as UserId;

function session(id: string, label: string): Session {
  return Session.fromJSON({
    id: id as SessionId,
    userId: OWNER,
    createdAt: '2026-09-01T09:00:00.000Z',
    lastUsedAt: '2026-09-18T18:30:00.000Z',
    expiresAt: '2026-10-01T09:00:00.000Z',
    revokedAt: null,
    // The documentation range reserved by RFC 5737. It belongs to nobody.
    clientAddress: '203.0.113.7',
    clientLabel: label,
  });
}

const HERE: OwnSession = { session: session('session-1', 'Firefox on Linux'), isCurrent: true };
const ELSEWHERE: OwnSession = { session: session('session-2', 'Safari on iOS'), isCurrent: false };

function list(sessions: OwnSession[]) {
  return mount(SessionList, { props: { sessions }, global: mountOptions() });
}

describe('SessionList', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one row per session', () => {
    expect(list([HERE, ELSEWHERE]).findAll('tbody tr')).toHaveLength(2);
    expect(list([ELSEWHERE]).findAll('tbody tr')).toHaveLength(1);
  });

  it('marks the current session', () => {
    const rows = list([HERE, ELSEWHERE]).findAll('tbody tr');
    expect(rows[0]?.text()).toContain('account.sessions.current');
  });

  it('does NOT mark the others', () => {
    // Without this, a component that badges every row passes the assertion
    // above, and the badge stops meaning anything at the moment it matters most
    // — when the person is deciding which session is not theirs.
    const rows = list([HERE, ELSEWHERE]).findAll('tbody tr');
    expect(rows[1]?.text()).not.toContain('account.sessions.current');
  });

  it('does NOT offer to revoke the current session', () => {
    const rows = list([HERE, ELSEWHERE]).findAll('tbody tr');
    expect(rows[0]?.findAll('button')).toHaveLength(0);
    // Paired with its opposite: an implementation that rendered no revoke
    // control at all would satisfy the line above on its own.
    expect(rows[1]?.findAll('button')).toHaveLength(1);
  });

  it('calls revoke with the right id', async () => {
    // Two rows, and the control on the second one: a component that always
    // emitted the first session's id passes a one-row test.
    const wrapper = list([HERE, ELSEWHERE]);
    await wrapper.findAll('tbody tr')[1]?.find('button').trigger('click');
    expect(wrapper.emitted('revoke')).toEqual([[ELSEWHERE.session.id]]);
  });

  it('does NOT offer to revoke anything while a request is in flight', () => {
    const rows = list([HERE, ELSEWHERE]).findAll('tbody tr');
    expect(rows[1]?.find('button').attributes('disabled')).toBeUndefined();
    const busy = mount(SessionList, {
      props: { sessions: [HERE, ELSEWHERE], busy: true },
      global: mountOptions(),
    });
    expect(busy.findAll('tbody tr')[1]?.find('button').attributes('disabled')).toBeDefined();
  });
});
