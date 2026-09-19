import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import IdentityList from '../organisms/IdentityList.vue';
import { mountOptions, stubAutoImports } from './harness';

const OWNER = 'user-1' as UserId;

function identity(id: string, provider: AuthProvider, account: string): AuthIdentity {
  return AuthIdentity.fromJSON({
    id: id as AuthIdentityId,
    userId: OWNER,
    provider,
    providerAccountId: account,
    createdAt: '2026-09-01T09:00:00.000Z',
    lastUsedAt: null,
  });
}

// `example.test` is reserved by RFC 6761 and resolves for nobody.
const BY_PASSWORD = identity('identity-1', AuthProvider.PASSWORD, 'ada@example.test');
const BY_GOOGLE = identity('identity-2', AuthProvider.GOOGLE, '117392044118');

function list(identities: AuthIdentity[]) {
  return mount(IdentityList, { props: { identities }, global: mountOptions() });
}

describe('IdentityList', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one row per identity, named by provider', () => {
    const wrapper = list([BY_PASSWORD, BY_GOOGLE]);
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    expect(wrapper.text()).toContain('account.identities.providerPassword');
    expect(wrapper.text()).toContain('account.identities.providerGoogle');
  });

  it('hides the unlink control when only one identity remains', () => {
    expect(list([BY_PASSWORD]).findAll('button')).toHaveLength(0);
  });

  it('offers it when more than one does', () => {
    // The other half of the assertion above, which a component rendering no
    // unlink control at all would otherwise satisfy on its own.
    expect(list([BY_PASSWORD, BY_GOOGLE]).findAll('button')).toHaveLength(2);
  });

  it('calls unlink with the right id', async () => {
    const wrapper = list([BY_PASSWORD, BY_GOOGLE]);
    await wrapper.findAll('tbody tr')[1]?.find('button').trigger('click');
    expect(wrapper.emitted('unlink')).toEqual([[BY_GOOGLE.id]]);
  });

  it('does NOT offer to unlink anything while a request is in flight', () => {
    const busy = mount(IdentityList, {
      props: { identities: [BY_PASSWORD, BY_GOOGLE], busy: true },
      global: mountOptions(),
    });
    expect(busy.find('button').attributes('disabled')).toBeDefined();
  });
});
