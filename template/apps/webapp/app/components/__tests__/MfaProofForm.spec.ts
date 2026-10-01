import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodId, MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { ProofReason } from '~/composables/useMfaMethods';
import MfaProofForm from '../organisms/MfaProofForm.vue';
import { mountOptions, stubAutoImports } from './harness';

function method(id: string, type: MfaMethodType, confirmedAt: string | null): MfaMethodJSON {
  return {
    id: id as MfaMethodId,
    userId: 'user-1' as UserId,
    type,
    label: id,
    createdAt: '2026-09-01T09:00:00.000Z',
    confirmedAt,
    lastUsedAt: null,
  };
}

const PHONE = method('phone', MfaMethodType.TOTP, '2026-09-01T09:05:00.000Z');
const KEY = method('key', MfaMethodType.WEBAUTHN, '2026-09-01T09:05:00.000Z');
const UNFINISHED = method('tablet', MfaMethodType.TOTP, null);

function form(
  reason: ProofReason,
  methods: MfaMethodJSON[] = [PHONE],
  action: 'remove' | 'regenerate' | 'confirmTotp' | 'enrollPasskey' = 'remove',
) {
  return mount(MfaProofForm, { props: { action, reason, methods }, global: mountOptions() });
}

describe('MfaProofForm', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains why a proof is wanted when none was sent, as an explanation and not an error', () => {
    const wrapper = form('required');
    expect(wrapper.text()).toContain('account.mfa.proof.requiredRemove');
    expect(wrapper.text()).not.toContain('account.mfa.proof.wrong');
    // An alert, but the informational kind: nothing on screen is styled as an error.
    expect(wrapper.find('[role="alert"]').classes()).toContain('bg-info-50');
    expect(wrapper.find('.bg-error-50').exists()).toBe(false);
  });

  it('says something different when a proof was sent and refused', () => {
    const wrapper = form('wrong');
    expect(wrapper.text()).toContain('account.mfa.proof.wrong');
    expect(wrapper.text()).not.toContain('account.mfa.proof.requiredRemove');
    expect(wrapper.find('[role="alert"]').classes()).toContain('bg-error-50');
  });

  it('words a regeneration\'s reason for itself', () => {
    const wrapper = form('required', [PHONE], 'regenerate');
    expect(wrapper.text()).toContain('account.mfa.proof.requiredRegenerate');
    expect(wrapper.text()).not.toContain('account.mfa.proof.requiredRemove');
  });

  it.each(['confirmTotp', 'enrollPasskey'] as const)(
    'words adding a factor (%s) for itself',
    (action) => {
      const wrapper = form('required', [PHONE], action);
      expect(wrapper.text()).toContain('account.mfa.proof.requiredEnroll');
      expect(wrapper.text()).not.toContain('account.mfa.proof.requiredRemove');
      expect(wrapper.text()).not.toContain('account.mfa.proof.requiredRegenerate');
    },
  );

  it('emits a method and its code, and nothing else', async () => {
    const wrapper = form('required');
    await wrapper.find('#proof-code').setValue(' 123456 ');
    await wrapper.find('form').trigger('submit');
    const proof = wrapper.emitted('submit')?.[0]?.[0] as Record<string, unknown>;
    expect(proof).toEqual({ methodId: 'phone', code: '123456' });
    expect('recoveryCode' in proof).toBe(false);
  });

  it('emits a recovery code and nothing else, after switching to one', async () => {
    const wrapper = form('required');
    await wrapper.findAll('button').find((b) => b.text() === 'account.mfa.proof.useRecovery')?.trigger('click');
    await wrapper.find('#proof-recovery-code').setValue('K7QD-M2XW-9P4R');
    await wrapper.find('form').trigger('submit');
    const proof = wrapper.emitted('submit')?.[0]?.[0] as Record<string, unknown>;
    expect(proof).toEqual({ recoveryCode: 'K7QD-M2XW-9P4R' });
    expect('methodId' in proof || 'code' in proof).toBe(false);
  });

  it('a code typed before switching is not sent along with the recovery code', async () => {
    const wrapper = form('required');
    await wrapper.find('#proof-code').setValue('123456');
    await wrapper.findAll('button').find((b) => b.text() === 'account.mfa.proof.useRecovery')?.trigger('click');
    await wrapper.find('#proof-recovery-code').setValue('K7QD-M2XW-9P4R');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({ recoveryCode: 'K7QD-M2XW-9P4R' });
  });

  it('offers only a recovery code when no confirmed authenticator app can supply a code', () => {
    // A passkey signs a challenge; it cannot type a code. An unfinished app has
    // never produced one the server accepted.
    const wrapper = form('required', [KEY, UNFINISHED]);
    expect(wrapper.find('#proof-code').exists()).toBe(false);
    expect(wrapper.find('#proof-recovery-code').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('account.mfa.proof.useRecovery');
  });

  it('lets the person back out', async () => {
    const wrapper = form('required');
    await wrapper.findAll('button').find((b) => b.text() === 'common.actions.cancel')?.trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
