import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import AppButton from '../components/atoms/AppButton.vue';

describe('AppButton', () => {
  beforeEach(() => {
    stubNuxtAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders its slot content', () => {
    const wrapper = mount(AppButton, { slots: { default: 'Save' } });
    expect(wrapper.text()).toBe('Save');
  });

  it('applies the secondary variant classes', () => {
    const wrapper = mount(AppButton, { props: { variant: 'secondary' } });
    expect(wrapper.classes()).toContain('bg-slate-100');
  });

  it('is disabled when told to be', () => {
    const wrapper = mount(AppButton, { props: { disabled: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
  });

  it('is not disabled by default', () => {
    // Without this, an implementation that hardcodes :disabled="true" passes the suite.
    const wrapper = mount(AppButton);
    expect(wrapper.attributes('disabled')).toBeUndefined();
  });

  it('does not apply primary classes to the secondary variant', () => {
    // Without this, an implementation that applies both class sets passes the suite.
    const wrapper = mount(AppButton, { props: { variant: 'secondary' } });
    expect(wrapper.classes()).not.toContain('bg-slate-900');
  });
});
