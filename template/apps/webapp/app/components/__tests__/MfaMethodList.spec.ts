import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodId, MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import MfaMethodList from '../organisms/MfaMethodList.vue';
import { mountOptions, stubAutoImports } from './harness';

function method(over: Partial<Omit<MfaMethodJSON, 'id'>> & { id: string }): MfaMethodJSON {
  return {
    userId: 'user-1' as UserId,
    type: MfaMethodType.TOTP,
    label: 'Phone',
    createdAt: '2026-09-01T09:00:00.000Z',
    confirmedAt: '2026-09-01T09:05:00.000Z',
    lastUsedAt: null,
    ...over,
    id: over.id as MfaMethodId,
  };
}

const PHONE = method({ id: 'method-1', label: 'Phone', lastUsedAt: '2026-09-18T18:30:00.000Z' });
const KEY = method({ id: 'method-2', label: 'Office key', type: MfaMethodType.WEBAUTHN });
const HALF_DONE = method({ id: 'method-3', label: 'Tablet', confirmedAt: null });

function list(methods: MfaMethodJSON[], busy = false) {
  return mount(MfaMethodList, { props: { methods, busy }, global: mountOptions() });
}

describe('MfaMethodList', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one row per method, named as the person named it, and of its kind', () => {
    const wrapper = list([PHONE, KEY]);
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    expect(wrapper.text()).toContain('Phone');
    expect(wrapper.text()).toContain('Office key');
    expect(wrapper.text()).toContain('account.mfa.typeTotp');
    expect(wrapper.text()).toContain('account.mfa.typeWebauthn');
  });

  it('says when a method was last used, and that one never was', () => {
    const wrapper = list([PHONE, KEY]);
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0]?.text()).toContain('Sep 18, 2026');
    expect(rows[1]?.text()).toContain('account.mfa.neverUsed');
  });

  it('marks a method whose enrollment was never finished, and only that one', () => {
    const wrapper = list([PHONE, HALF_DONE]);
    const rows = wrapper.findAll('tbody tr');
    expect(rows[0]?.text()).not.toContain('account.mfa.unconfirmed');
    expect(rows[1]?.text()).toContain('account.mfa.unconfirmed');
  });

  it('offers to remove the last method too: whether that needs a proof is the server\'s to say', async () => {
    const wrapper = list([PHONE]);
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(1);
    await buttons[0]?.trigger('click');
    expect(wrapper.emitted('remove')).toEqual([['method-1']]);
  });

  it('emits the id of the row that was clicked', async () => {
    const wrapper = list([PHONE, KEY]);
    await wrapper.findAll('tbody tr')[1]?.find('button').trigger('click');
    expect(wrapper.emitted('remove')).toEqual([['method-2']]);
  });

  it('disables every control while a request is in flight', () => {
    const wrapper = list([PHONE, KEY], true);
    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(true);
  });

  it('renders only what the listing carries: nothing that looks like secret material', () => {
    // The wire shape has no field for one, so this is a check that the markup
    // does not reach for a field the type does not have. The html is compared
    // against the whole method as JSON, so a new column would have to be a
    // field of it.
    const html = list([PHONE]).html();
    for (const word of ['secret', 'otpauth', 'publicKey', 'counter', 'credentialId']) {
      expect(html).not.toContain(word);
    }
  });
});
