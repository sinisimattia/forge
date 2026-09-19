import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import AppTableRow from '../components/atoms/AppTableRow.vue';

describe('AppTableRow', () => {
  beforeEach(() => {
    stubNuxtAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts an interactive row in the tab order', () => {
    const wrapper = mount(AppTableRow, { props: { interactive: true } });
    expect(wrapper.attributes('tabindex')).toBe('0');
  });

  it('keeps a plain row out of the tab order', () => {
    // Without this, a row that is always focusable passes the assertion above — and every
    // non-interactive row in a long table becomes a tab stop.
    const wrapper = mount(AppTableRow);
    expect(wrapper.attributes('tabindex')).toBeUndefined();
  });

  it('activates on Enter and on Space when interactive', async () => {
    const wrapper = mount(AppTableRow, { props: { interactive: true } });
    await wrapper.trigger('keydown.enter');
    await wrapper.trigger('keydown.space');
    expect(wrapper.emitted('click')).toHaveLength(2);
  });

  it('does not activate on a key when it is not interactive', async () => {
    // Without this, a row that emits on every keystroke regardless of `interactive` passes
    // the assertion above.
    const wrapper = mount(AppTableRow);
    await wrapper.trigger('keydown.enter');
    await wrapper.trigger('keydown.space');
    expect(wrapper.emitted('click')).toBeUndefined();
  });

  it('applies the interactive affordance classes, and only when interactive', () => {
    const interactive = mount(AppTableRow, { props: { interactive: true } });
    const plain = mount(AppTableRow);
    expect(interactive.classes()).toContain('cursor-pointer');
    expect(plain.classes()).not.toContain('cursor-pointer');
  });

  it('applies the selected background, and only when selected', () => {
    const selected = mount(AppTableRow, { props: { selected: true } });
    const plain = mount(AppTableRow);
    expect(selected.classes()).toContain('bg-neutral-50');
    expect(plain.classes()).not.toContain('bg-neutral-50');
  });
});
