import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import PasswordField from '../molecules/PasswordField.vue';
import { mountOptions, stubAutoImports } from './harness';

/**
 * What this suite is really pinning is that the field shows **core's** judgement
 * and not its own.
 *
 * The expectations are therefore written as facts about secrets — five
 * characters is short, thirty is not — and never derived by calling
 * `evaluatePassword` here. A spec that computed its expectation the way the
 * component computes its answer agrees with the component whatever either of
 * them does, including when both are wrong, and would go on passing against a
 * component that had quietly grown its own copy of the rule.
 *
 * `DEFAULT_PASSWORD_POLICY.minLength` is read once, in an assertion about the
 * *shipped policy* rather than about the component: it is there so that a
 * deployment which changes the minimum finds this file, rather than finding a
 * suite that silently stopped testing anything (thirty characters is not long
 * enough to be "compliant" under every conceivable policy).
 */
const SHORT = 'abcde';
const COMPLIANT = 'a correct horse battery staple';

function field(props: Record<string, unknown> = {}) {
  return mount(PasswordField, {
    props: { id: 'field', label: 'Password', checkPolicy: true, ...props },
    global: mountOptions(),
  });
}

describe('PasswordField', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the shipped policy is one these fixtures actually straddle', () => {
    // Not a test of the component. It is what stops the two fixtures below from
    // becoming meaningless if the policy moves: if the minimum ever exceeded
    // thirty, `COMPLIANT` would stop being compliant and every assertion here
    // would go on passing for the wrong reason.
    expect(SHORT.length).toBeLessThan(DEFAULT_PASSWORD_POLICY.minLength);
    expect(COMPLIANT.length).toBeGreaterThanOrEqual(DEFAULT_PASSWORD_POLICY.minLength);
    expect(COMPLIANT.length).toBeLessThanOrEqual(DEFAULT_PASSWORD_POLICY.maxLength);
  });

  it('shows a violation for a short secret', async () => {
    const wrapper = field();
    await wrapper.find('input').setValue(SHORT);
    expect(wrapper.text()).toContain('auth.passwordRules.tooShort');
  });

  it('shows none for a compliant one', async () => {
    const wrapper = field();
    await wrapper.find('input').setValue(COMPLIANT);
    expect(wrapper.text()).not.toContain('auth.passwordRules.');
  });

  it('does NOT show a violation the policy did not raise', async () => {
    // Without this, a component that listed every rule it knows about — rather
    // than the ones broken — passes the two assertions above. `COMPLIANT` is all
    // lower case and has no digit, and the shipped policy asks for neither.
    const wrapper = field();
    await wrapper.find('input').setValue(COMPLIANT);
    expect(wrapper.text()).not.toContain('auth.passwordRules.needsMixedCase');
    expect(wrapper.text()).not.toContain('auth.passwordRules.needsDigit');
  });

  it('does NOT judge anything until something has been typed', async () => {
    // An empty field has not failed at anything, and a field that shouted
    // "too short" at a person who had typed nothing would pass the first
    // assertion above.
    const wrapper = field();
    expect(wrapper.text()).not.toContain('auth.passwordRules.');
    await wrapper.find('input').setValue('');
    expect(wrapper.text()).not.toContain('auth.passwordRules.');
  });

  it('does NOT judge a secret the person already holds', async () => {
    // `checkPolicy` off is the sign-in case. Telling somebody their own working
    // password is invalid is the bug; it is also how the current policy gets
    // published to anybody who types three characters into a form.
    const wrapper = field({ checkPolicy: false });
    await wrapper.find('input').setValue(SHORT);
    expect(wrapper.text()).not.toContain('auth.passwordRules.');
  });

  it('shows a violation only the server could know about', async () => {
    const wrapper = field({ checkPolicy: false, reportedViolations: ['BREACHED'] });
    await wrapper.find('input').setValue(COMPLIANT);
    expect(wrapper.text()).toContain('auth.passwordRules.breached');
  });

  it('hides the secret until the reveal control is used, and hides it again', async () => {
    const wrapper = field();
    const input = wrapper.find('input');
    expect(input.attributes('type')).toBe('password');
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('input').attributes('type')).toBe('text');
    await wrapper.find('button').trigger('click');
    expect(wrapper.find('input').attributes('type')).toBe('password');
  });
});
