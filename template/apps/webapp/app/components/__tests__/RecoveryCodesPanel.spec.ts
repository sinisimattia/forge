import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import RecoveryCodesPanel from '../organisms/RecoveryCodesPanel.vue';
import { mountOptions, stubAutoImports } from './harness';

/** The shape the server mints: upper case, dashed. A lower-case probe would prove nothing about them. */
const CODES = ['K7QD-M2XW-9P4R', 'H3TB-Z8NC-5V6J', 'W9FA-R4YE-2L7S'];

/** Every panel mounted, so `afterEach` can unmount them: each holds a window listener. */
const mounted: { unmount: () => void }[] = [];

function panel() {
  const wrapper = mount(RecoveryCodesPanel, { props: { codes: CODES }, global: mountOptions() });
  mounted.push(wrapper);
  return wrapper;
}

describe('RecoveryCodesPanel', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows every code', () => {
    const text = panel().text();
    for (const code of CODES) expect(text).toContain(code);
  });

  it('says they will not be shown again, above the codes', () => {
    const wrapper = panel();
    const html = wrapper.html();
    expect(wrapper.text()).toContain('account.mfa.recovery.showOnce');
    expect(html.indexOf('account.mfa.recovery.showOnce')).toBeLessThan(html.indexOf(CODES[0] ?? ''));
  });

  it('will not let the person finish until they say they have kept them', async () => {
    const wrapper = panel();
    const done = wrapper.findAll('button').find((b) => b.text() === 'account.mfa.recovery.done');
    expect(done?.attributes('disabled')).toBeDefined();
    await done?.trigger('click');
    expect(wrapper.emitted('dismiss')).toBeUndefined();

    await wrapper.find('#recovery-saved').setValue(true);
    expect(done?.attributes('disabled')).toBeUndefined();
    await done?.trigger('click');
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('copies them one per line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = panel();
    await wrapper.findAll('button').find((b) => b.text() === 'account.mfa.recovery.copy')?.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(`${CODES.join('\n')}\n`);
    expect(wrapper.text()).toContain('account.mfa.recovery.copied');
  });

  it('says so when the clipboard refuses, rather than claiming they were copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const wrapper = panel();
    await wrapper.findAll('button').find((b) => b.text() === 'account.mfa.recovery.copy')?.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('account.mfa.recovery.copyFailed');
    expect(wrapper.text()).not.toContain('account.mfa.recovery.copied');
  });

  it('downloads them as a text file, and does not leave the object URL live', async () => {
    let blob: Blob | undefined;
    const create = vi.fn((given: Blob) => {
      blob = given;
      return 'blob:test';
    });
    const revoke = vi.fn();
    vi.useFakeTimers();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const wrapper = panel();
    await wrapper.findAll('button').find((b) => b.text() === 'account.mfa.recovery.download')?.trigger('click');
    expect(await blob?.text()).toBe(`${CODES.join('\n')}\n`);
    // Not yet: a browser may start the download after the handler returns.
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:test');
    vi.useRealTimers();
  });

  it('reports whether the codes are kept, for the page\'s route guard to read', async () => {
    const wrapper = panel();
    await wrapper.find('#recovery-saved').setValue(true);
    await wrapper.find('#recovery-saved').setValue(false);
    expect(wrapper.emitted('update:saved')).toEqual([[true], [false]]);
  });

  it('registers no route guard of its own: it works, and stays quiet, outside a route component', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    panel();
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks the browser to confirm a close while they are unkept, and stops once they are kept', async () => {
    const wrapper = panel();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);

    await wrapper.find('#recovery-saved').setValue(true);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);

    wrapper.unmount();
    const gone = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(gone);
    expect(gone.defaultPrevented).toBe(false);
  });
});
