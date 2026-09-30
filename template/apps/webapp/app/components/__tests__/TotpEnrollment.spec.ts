import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { TotpEnrollmentBody } from '~/types';
import TotpEnrollment from '../organisms/TotpEnrollment.vue';
import { mountOptions, stubAutoImports } from './harness';

/** Shaped like the real thing (base32, upper case) and given to no authenticator. */
const BASE32_SEED = 'JBSWY3DPEHPK3PXP';

const OFFER: TotpEnrollmentBody = {
  methodId: 'method-1',
  otpauthUri: `otpauth://totp/Example:ada%40example.test?secret=${BASE32_SEED}&issuer=Example`,
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>',
  secret: BASE32_SEED,
};

function enrollment(props: { wrongCode?: boolean; busy?: boolean } = {}) {
  return mount(TotpEnrollment, { props: { offer: OFFER, ...props }, global: mountOptions() });
}

describe('TotpEnrollment', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the QR, as an image the server\'s SVG is given to and not as markup', () => {
    const wrapper = enrollment();
    const image = wrapper.find('img');
    expect(image.exists()).toBe(true);
    const source = image.attributes('src') ?? '';
    expect(source.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(source.slice(source.indexOf(',') + 1))).toBe(OFFER.qrSvg);
    // Nothing of the SVG is in the page's own markup.
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(image.attributes('alt')).toBe('account.mfa.enroll.qrAlt');
  });

  it('shows the secret for manual entry, beside the QR and not behind a control', () => {
    const wrapper = enrollment();
    expect(wrapper.find('#totp-secret').text()).toBe(OFFER.secret);
    expect(wrapper.text()).toContain('account.mfa.enroll.manual');
  });

  it('emits the code the person typed, trimmed', async () => {
    const wrapper = enrollment();
    await wrapper.find('#totp-code').setValue(' 123456 ');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('confirm')).toEqual([['123456']]);
  });

  it('says so when the code was wrong, and not otherwise', () => {
    expect(enrollment().text()).not.toContain('account.mfa.enroll.wrongCode');
    expect(enrollment({ wrongCode: true }).text()).toContain('account.mfa.enroll.wrongCode');
  });

  it('can be abandoned', async () => {
    const wrapper = enrollment();
    const cancel = wrapper.findAll('button').find((b) => b.text() === 'common.actions.cancel');
    await cancel?.trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
