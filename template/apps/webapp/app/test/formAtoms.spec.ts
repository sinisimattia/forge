import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import AppInput from '../components/atoms/AppInput.vue';
import AppTextarea from '../components/atoms/AppTextarea.vue';
import AppSelect from '../components/atoms/AppSelect.vue';
import AppCheckbox from '../components/atoms/AppCheckbox.vue';

/**
 * The four atoms that carry a `defineModel`.
 *
 * `defineModel` is not a different contract from the `modelValue` prop plus
 * `update:modelValue` emit that it replaced — it compiles to exactly that pair. That is the
 * whole reason the conversion was safe, and it is precisely the kind of claim that is
 * believed rather than tested until it breaks someone's form. These specs pin both halves for
 * each atom: the prop reaches the native element, and editing the native element emits the
 * update a `v-model` binding needs.
 *
 * Without the second half, an atom that rendered the value but never emitted would pass a
 * render-only suite while silently making every form read-only.
 */
const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('the defineModel form atoms', () => {
  beforeEach(() => {
    stubNuxtAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('AppInput', () => {
    it('renders the bound value', () => {
      const wrapper = mount(AppInput, { props: { modelValue: 'hello' } });
      expect(wrapper.find('input').element.value).toBe('hello');
    });

    it('renders an empty value when none is bound', () => {
      // Without this, an atom that hardcodes its content passes the assertion above.
      const wrapper = mount(AppInput);
      expect(wrapper.find('input').element.value).toBe('');
    });

    it('emits the typed value', async () => {
      const wrapper = mount(AppInput, { props: { modelValue: '' } });
      await wrapper.find('input').setValue('typed');
      expect(wrapper.emitted('update:modelValue')).toEqual([['typed']]);
    });

    it('passes its type through to the native element', () => {
      // `type="password"` is the case a login form depends on; a default-only atom would
      // render every field as plain text.
      expect(mount(AppInput).find('input').attributes('type')).toBe('text');
      expect(
        mount(AppInput, { props: { type: 'password' } }).find('input').attributes('type'),
      ).toBe('password');
    });

    it('applies the error styling only when it has an error', () => {
      const bad = mount(AppInput, { props: { hasError: true } });
      const good = mount(AppInput);
      expect(bad.find('input').classes()).toContain('border-error-300');
      expect(good.find('input').classes()).not.toContain('border-error-300');
    });
  });

  describe('AppTextarea', () => {
    it('renders the bound value', () => {
      const wrapper = mount(AppTextarea, { props: { modelValue: 'a note' } });
      expect(wrapper.find('textarea').element.value).toBe('a note');
    });

    it('renders an empty value when none is bound', () => {
      const wrapper = mount(AppTextarea);
      expect(wrapper.find('textarea').element.value).toBe('');
    });

    it('emits the typed value', async () => {
      const wrapper = mount(AppTextarea, { props: { modelValue: '' } });
      await wrapper.find('textarea').setValue('written');
      expect(wrapper.emitted('update:modelValue')).toEqual([['written']]);
    });
  });

  describe('AppSelect', () => {
    it('renders the bound selection', () => {
      const wrapper = mount(AppSelect, { props: { options, modelValue: 'b' } });
      expect(wrapper.find('select').element.value).toBe('b');
    });

    it('selects nothing when nothing is bound', () => {
      // Without this, a select that always lands on the first option passes the assertion
      // above whenever the test happens to bind the first option.
      const wrapper = mount(AppSelect, { props: { options } });
      expect(wrapper.find('select').element.value).toBe('');
    });

    it('emits the chosen value', async () => {
      const wrapper = mount(AppSelect, { props: { options, modelValue: 'a' } });
      await wrapper.find('select').setValue('b');
      expect(wrapper.emitted('update:modelValue')).toEqual([['b']]);
    });

    it('renders one option per entry, plus the placeholder when there is one', () => {
      expect(mount(AppSelect, { props: { options } }).findAll('option')).toHaveLength(2);
      expect(
        mount(AppSelect, { props: { options, placeholder: 'Pick one' } }).findAll('option'),
      ).toHaveLength(3);
    });
  });

  describe('AppCheckbox', () => {
    it('renders checked when bound true', () => {
      const wrapper = mount(AppCheckbox, { props: { modelValue: true } });
      expect(wrapper.find('input').element.checked).toBe(true);
    });

    it('renders unchecked when bound false', () => {
      const wrapper = mount(AppCheckbox, { props: { modelValue: false } });
      expect(wrapper.find('input').element.checked).toBe(false);
    });

    it('emits a boolean, not the string value of the input', async () => {
      // A checkbox bound with `:value`/`@change` rather than `v-model` emits `'on'` here,
      // which is truthy and therefore passes any assertion that only checks truthiness.
      const wrapper = mount(AppCheckbox, { props: { modelValue: false } });
      await wrapper.find('input').setValue(true);
      expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
    });

    it('emits false when unchecked', async () => {
      const wrapper = mount(AppCheckbox, { props: { modelValue: true } });
      await wrapper.find('input').setValue(false);
      expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    });
  });
});
