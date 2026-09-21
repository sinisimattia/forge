import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import OAuthButtons from '../organisms/OAuthButtons.vue';
import { mountOptions, stubAutoImports } from './harness';

function buttons(providers: AuthProvider[], busy = false) {
  return mount(OAuthButtons, { props: { providers, busy }, global: mountOptions() });
}

describe('OAuthButtons', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one button per configured provider', () => {
    const wrapper = buttons([AuthProvider.GOOGLE, AuthProvider.GITHUB]);
    expect(wrapper.findAll('button')).toHaveLength(2);
  });

  // ADR-0008: an unconfigured provider is ABSENT from the login page, not a
  // heading with an empty list beneath it and not a divider with nothing
  // below it. `wrapper.html()` is the literal rendered markup, so this is
  // the assertion a stray wrapping element — added for spacing, or for a
  // heading — would break silently, which is exactly why it is written as
  // the exact empty string rather than as "no button is found".
  it('renders nothing at all when no provider is configured', () => {
    const wrapper = buttons([]);
    expect(wrapper.html()).toBe('');
  });

  it('labels each provider from the same Record IdentityList uses', () => {
    // `IdentityList.spec.ts` asserts these same two literal key strings
    // (`account.identities.providerGoogle`, `account.identities.providerGithub`)
    // as the whole of what it means for that table to name a provider. This
    // component composing them into `auth.oauth.continueWith` rather than
    // showing them bare is a different sentence built from the identical
    // shared key — not a different vocabulary for the same provider.
    const wrapper = buttons([AuthProvider.GOOGLE, AuthProvider.GITHUB, AuthProvider.OIDC]);

    expect(wrapper.text()).toContain('account.identities.providerGoogle');
    expect(wrapper.text()).toContain('account.identities.providerGithub');
    expect(wrapper.text()).toContain('account.identities.providerOidc');
  });

  it('never renders PASSWORD as a button', () => {
    // It is a member of the enum, named in the very Record this component
    // imports, and it is not a federated provider — the backend's
    // `/auth/oauth/providers` never lists it. This asserts the component
    // would not render one even if it somehow arrived in `providers`.
    const wrapper = buttons([AuthProvider.PASSWORD, AuthProvider.GOOGLE]);

    expect(wrapper.findAll('button')).toHaveLength(1);
    expect(wrapper.text()).not.toContain('account.identities.providerPassword');
  });

  it('emits choose with the right provider when pressed', async () => {
    const wrapper = buttons([AuthProvider.GOOGLE, AuthProvider.GITHUB]);

    await wrapper.findAll('button')[1]?.trigger('click');

    expect(wrapper.emitted('choose')).toEqual([[AuthProvider.GITHUB]]);
  });

  it('disables every button while busy', () => {
    const wrapper = buttons([AuthProvider.GOOGLE, AuthProvider.GITHUB], true);

    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined();
    }
  });

  it('is NOT disabled when not busy', () => {
    const wrapper = buttons([AuthProvider.GOOGLE]);
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
  });
});
