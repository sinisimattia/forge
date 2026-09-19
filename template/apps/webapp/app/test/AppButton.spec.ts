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
    expect(wrapper.classes()).toContain('bg-surface');
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
    expect(wrapper.classes()).not.toContain('bg-primary-600');
  });

  // The three assertions below cover the props this atom gained when it was re-based onto
  // the design system. Each one is paired with its opposite, for the reason the two
  // assertions above spell out: an assertion whose subject the component emits regardless
  // of its props is a claim about nothing.

  it('is disabled while loading, and shows the spinner', () => {
    const wrapper = mount(AppButton, { props: { loading: true } });
    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('is neither disabled nor spinning when not loading', () => {
    // Without this, an implementation that always renders the spinner and always disables
    // passes the assertion above. `disabled` is asserted here as well as in the default
    // case because `:disabled="disabled || loading"` has two inputs, and a regression in
    // either half must be visible.
    const wrapper = mount(AppButton, { props: { loading: false } });
    expect(wrapper.attributes('disabled')).toBeUndefined();
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('renders the type it is given, defaulting to button', () => {
    // A form-submitting button is the reason this prop exists, and the default must NOT be
    // `submit` — an atom that silently submits its enclosing form is the bug this pins.
    expect(mount(AppButton).attributes('type')).toBe('button');
    expect(mount(AppButton, { props: { type: 'submit' } }).attributes('type')).toBe('submit');
  });

  it('drops the styled base classes for the unstyled variant, and keeps them otherwise', () => {
    const unstyled = mount(AppButton, { props: { variant: 'unstyled' } });
    const styled = mount(AppButton, { props: { variant: 'primary' } });
    expect(unstyled.classes()).not.toContain('rounded-md');
    expect(styled.classes()).toContain('rounded-md');
  });

  it('applies the size it is given, and only that size', () => {
    const large = mount(AppButton, { props: { size: 'lg' } });
    expect(large.classes()).toContain('px-6');
    // The medium default's padding must be gone, or `classes` is concatenating every size.
    expect(large.classes()).not.toContain('px-4');
  });
});
