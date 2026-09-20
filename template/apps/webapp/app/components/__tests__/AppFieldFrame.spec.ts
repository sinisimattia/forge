import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import AppFieldFrame from '../atoms/AppFieldFrame.vue';
import FormField from '../molecules/FormField.vue';
import PasswordField from '../molecules/PasswordField.vue';
import { mountOptions, stubAutoImports } from './harness';

/**
 * The atom that exists so two molecules stop carrying the same markup twice.
 *
 * The last suite here is the one that makes it stick. `FormField` and
 * `PasswordField` cannot compose each other — a molecule may not render its own
 * layer — so before this atom existed `PasswordField` held a copy of the other's
 * label and error markup. `npm run layers` can see a molecule rendering a
 * molecule; nothing can see two molecules' chrome drifting apart. Asserting that
 * the two render the *same* label and the *same* error element is the only thing
 * that can, so re-inlining the chrome into either one turns this red.
 */
const CHROME = { id: 'field', label: 'Email address', required: true, error: 'Not valid.' };

describe('AppFieldFrame', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('labels the control it is given', () => {
    const wrapper = mount(AppFieldFrame, { props: { id: 'x', label: 'Email address' } });
    const label = wrapper.find('label');
    expect(label.text()).toContain('Email address');
    expect(label.attributes('for')).toBe('x');
  });

  it('does NOT render a label element when there is no label', () => {
    // An empty `<label for="x">` is a control with an accessible name of "", which
    // reads worse to a screen reader than no label element at all.
    expect(mount(AppFieldFrame, { props: { id: 'x' } }).find('label').exists()).toBe(false);
  });

  it('marks a required field, and only a required one', () => {
    const required = mount(AppFieldFrame, { props: { label: 'L', required: true } });
    const optional = mount(AppFieldFrame, { props: { label: 'L' } });
    expect(required.text()).toContain('*');
    expect(optional.text()).not.toContain('*');
  });

  it('shows a message when there is one, and nothing when there is not', () => {
    const failed = mount(AppFieldFrame, { props: { label: 'L', error: 'Not valid.' } });
    const fine = mount(AppFieldFrame, { props: { label: 'L' } });
    expect(failed.find('p').exists()).toBe(true);
    expect(failed.text()).toContain('Not valid.');
    expect(fine.find('p').exists()).toBe(false);
  });

  it('renders whatever control it is handed', () => {
    const wrapper = mount(AppFieldFrame, {
      props: { label: 'L' },
      slots: { default: '<input id="inner">' },
    });
    expect(wrapper.find('input#inner').exists()).toBe(true);
  });
});

describe('the two field molecules', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('render the same label element as each other', () => {
    const plain = mount(FormField, { props: CHROME, global: mountOptions() });
    const secret = mount(PasswordField, { props: CHROME, global: mountOptions() });
    expect(secret.find('label').html()).toBe(plain.find('label').html());
  });

  it('render the same error element as each other', () => {
    const plain = mount(FormField, { props: CHROME, global: mountOptions() });
    const secret = mount(PasswordField, { props: CHROME, global: mountOptions() });
    expect(secret.find('p').html()).toBe(plain.find('p').html());
  });

  it('really do render one — otherwise the two above compare nothing', () => {
    // Two `find()`s that both miss return two empty wrappers, and
    // `expect(a.html()).toBe(b.html())` on a pair of misses is a tautology. This
    // is what stops the two assertions above passing against a field that lost
    // its label and its message entirely.
    const plain = mount(FormField, { props: CHROME, global: mountOptions() });
    expect(plain.find('label').exists()).toBe(true);
    expect(plain.find('p').exists()).toBe(true);
    expect(plain.find('label').text()).toContain('Email address');
    expect(plain.find('p').text()).toContain('Not valid.');
  });
});
