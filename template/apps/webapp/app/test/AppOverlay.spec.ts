import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import AppOverlay from '../components/atoms/AppOverlay.vue';

/**
 * `Teleport` is stubbed throughout. The overlay renders into `body`, which puts its markup
 * outside the wrapper where `find` cannot reach it; the stub renders it in place instead, so
 * every query below addresses the real element rather than a copy.
 */
const teleportStubbed = { global: { stubs: { teleport: true } } };

// The container is addressed by its layout classes, never by `[tabindex="-1"]`. Selecting on
// the attribute one of these tests asserts makes the others fail for the wrong reason when it
// changes — observed while fault-injecting this suite, where flipping the tabindex to 0 took
// the two Escape tests down with it and hid which assertion had actually caught the fault.
const CONTAINER = '.fixed.inset-0.z-50';

describe('AppOverlay', () => {
  beforeEach(() => {
    stubNuxtAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders its slot while open', () => {
    const wrapper = mount(AppOverlay, {
      props: { open: true },
      slots: { default: '<p>Dialog body</p>' },
      ...teleportStubbed,
    });
    expect(wrapper.text()).toContain('Dialog body');
  });

  it('renders nothing while closed', () => {
    // Without this, a component that ignores `open` entirely passes the assertion above.
    const wrapper = mount(AppOverlay, {
      props: { open: false },
      slots: { default: '<p>Dialog body</p>' },
      ...teleportStubbed,
    });
    expect(wrapper.text()).not.toContain('Dialog body');
  });

  it('closes on Escape', async () => {
    const wrapper = mount(AppOverlay, { props: { open: true }, ...teleportStubbed });
    await wrapper.find(CONTAINER).trigger('keydown.escape');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('does not close on another key', async () => {
    // Without this, a handler bound to every keystroke passes the assertion above.
    const wrapper = mount(AppOverlay, { props: { open: true }, ...teleportStubbed });
    await wrapper.find(CONTAINER).trigger('keydown', { key: 'a' });
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('is focusable without being a tab stop', () => {
    // -1, not 0: the container is focused programmatically when it opens so that Escape
    // works immediately, but it must not sit in the page's tab order.
    const wrapper = mount(AppOverlay, { props: { open: true }, ...teleportStubbed });
    expect(wrapper.find(CONTAINER).attributes('tabindex')).toBe('-1');
  });

  it('closes when the backdrop is clicked', async () => {
    const wrapper = mount(AppOverlay, { props: { open: true }, ...teleportStubbed });
    await wrapper.find('.bg-backdrop\\/50').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('ignores the backdrop click when told to', async () => {
    // Without this, a component that always closes on backdrop passes the assertion above.
    const wrapper = mount(AppOverlay, {
      props: { open: true, closeOnBackdrop: false },
      ...teleportStubbed,
    });
    await wrapper.find('.bg-backdrop\\/50').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
