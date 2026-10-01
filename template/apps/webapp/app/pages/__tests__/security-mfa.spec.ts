import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodId, MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { mountOptions, stubAutoImports } from '~/components/__tests__/harness';
import { ApiError } from '~/fetchers';
import { useAuthStore } from '~/stores/auth';
import type { ApiClient, ApiErrorBody, ApiErrorCode, ApiRequest } from '~/types';
import SecurityPage from '../account/security.vue';

/**
 * The second-factor half of the security page, against a model of the server's
 * rules for it.
 *
 * ## What is modelled, and what is not
 *
 * Only the rules this screen's behaviour depends on: a removal of the last
 * confirmed method needs a proof (`403` without one, `422` with a wrong one), a
 * regeneration always does, and the recovery batch comes back on the first
 * confirmation only. The stub is the webapp's model of the backend, as
 * `stubBackend` is; the backend's own specs are what say the real one behaves so.
 *
 * ## The values are shaped like the real ones
 *
 * The secret is base32 upper case and the recovery codes are upper case with
 * dashes, so the absence assertions below compare a value of the shape that
 * really flows against text and state that would really contain it. Each such
 * assertion is preceded by the same probe returning true on the page where the
 * value is displayed — an absence check that has never seen its subject present
 * proves nothing.
 */

/**
 * The browser's passkey library: the ceremony is the one thing mocked, because it
 * needs an authenticator. **Armed per test and refusing by default**, so a test
 * that forgets to arm it gets a dismissed prompt rather than a ceremony that
 * completes on whatever a previous test left behind.
 */
const browser = vi.hoisted(() => ({
  attestation: null as Record<string, unknown> | null,
  calls: [] as unknown[],
}));

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: vi.fn(async (input: unknown) => {
    browser.calls.push(input);
    if (browser.attestation === null) {
      throw new Error('The operation either timed out or was not allowed.');
    }
    return browser.attestation;
  }),
}));

/**
 * The page registers a route-leave guard, which needs a router this file does not
 * have. The guards are captured so a case can call the one the page registered.
 */
const routing = vi.hoisted(() => ({ guards: [] as (() => unknown)[] }));

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard: () => unknown) => {
    routing.guards.push(guard);
  },
}));

const PASSKEY_OPTIONS = { challenge: 'server-challenge', rp: { name: 'Example' }, user: { id: 'u1' } };
const GOOD_ATTESTATION = { id: 'attestation-good', type: 'public-key' };

// Base32, upper case, and given to no authenticator.
const BASE32_SEED = 'JBSWY3DPEHPK3PXP';
const RECOVERY = ['K7QD-M2XW-9P4R', 'H3TB-Z8NC-5V6J', 'W9FA-R4YE-2L7S'];
const NEXT_RECOVERY = ['B2CD-N8XW-3P5R', 'T4YB-Q7NC-6V8J', 'D9FA-M5YE-4L2S'];
/** How many codes a freshly issued batch holds, as the server counts them. */
const WHOLE_BATCH = 10;
const RIGHT_CODE = '123456';
const WRONG_CODE = '654321';
const SPARE_RECOVERY = 'Z2QD-M2XW-9P4R';
const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>';

function refusal(status: number, code: ApiErrorCode): ApiError {
  const body: ApiErrorBody = { error: 'Refused', message: 'Refused.', code };
  return new ApiError(status, body);
}

function totp(id: string, label: string, confirmed: boolean): MfaMethodJSON {
  return {
    id: id as MfaMethodId,
    userId: 'user-1' as UserId,
    type: MfaMethodType.TOTP,
    label,
    createdAt: '2026-09-01T09:00:00.000Z',
    confirmedAt: confirmed ? '2026-09-01T09:05:00.000Z' : null,
    lastUsedAt: null,
  };
}

/** The server's rules for `/mfa`, over a mutable list, recording every request. */
function mfaBackend(initial: MfaMethodJSON[], remaining?: number) {
  let methods = [...initial];
  let hasRecoveryBatch = initial.some((m) => m.confirmedAt !== null);
  /**
   * What `GET /mfa/methods` reports as left. Defaults to a whole batch for an
   * account that holds one and to none otherwise, as the server does; a batch
   * issued or regenerated here is a whole one again.
   */
  let recoveryCodesRemaining = remaining ?? (hasRecoveryBatch ? WHOLE_BATCH : 0);
  /**
   * Whether the account holds a pending passkey-enrollment challenge. Minted by
   * the options request and **spent by the first verify that gets past the
   * proof requirement**, whatever happens next — as the route does — so a second
   * submit of one ceremony is refused for ever and a spec can see it.
   */
  let enrollmentChallenge = false;
  const requests: ApiRequest[] = [];
  /** `VERB path` -> how many matching calls still succeed before every later one answers 500. */
  const breaking = new Map<string, number>();

  /** Whether `body` proves the second factor: a right code, or an unused recovery code. */
  function proves(body: unknown): 'none' | 'wrong' | 'ok' {
    const proof = (body ?? {}) as Record<string, unknown>;
    if ('methodId' in proof && 'code' in proof) return proof.code === RIGHT_CODE ? 'ok' : 'wrong';
    if ('recoveryCode' in proof) return proof.recoveryCode === SPARE_RECOVERY ? 'ok' : 'wrong';
    return 'none';
  }

  const client: ApiClient = <T>(request: ApiRequest): Promise<T> => {
    requests.push(request);
    const key = `${request.method} ${request.path}`;
    const allowed = breaking.get(key);
    if (allowed !== undefined) {
      if (allowed <= 0) {
        return Promise.reject(new ApiError(500, { error: 'Internal Server Error', message: 'Boom.' }));
      }
      breaking.set(key, allowed - 1);
    }
    const answer = (value: unknown): Promise<T> => Promise.resolve(value as T);
    const { method, path, body } = request;

    if (method === 'GET' && path === '/mfa/methods') return answer({ methods, recoveryCodesRemaining });

    if (method === 'POST' && path === '/mfa/totp/enroll') {
      const label = String((body as { label?: unknown }).label ?? '').trim();
      if (label === '') return Promise.reject(refusal(422, 'MFA_LABEL_REQUIRED'));
      methods = [...methods, totp('method-new', label, false)];
      return answer({
        methodId: 'method-new',
        otpauthUri: `otpauth://totp/Example:ada%40example.test?secret=${BASE32_SEED}&issuer=Example`,
        qrSvg: QR,
        secret: BASE32_SEED,
      });
    }

    if (method === 'POST' && path === '/mfa/totp/confirm') {
      const given = body as { methodId: string; code: string; proof?: unknown };
      // The server's rule for adding a factor: an account that already holds a
      // confirmed method is owed a proof of it, and its first factor is not.
      if (methods.some((m) => m.confirmedAt !== null)) {
        const verdict = proves(given.proof);
        if (verdict === 'none') return Promise.reject(refusal(403, 'MFA_REAUTHENTICATION_REQUIRED'));
        if (verdict === 'wrong') return Promise.reject(refusal(422, 'MFA_VERIFICATION_FAILED'));
      }
      if (given.code !== RIGHT_CODE) return Promise.reject(refusal(422, 'MFA_VERIFICATION_FAILED'));
      methods = methods.map((m) => (m.id === given.methodId ? totp(m.id, m.label, true) : m));
      const first = !hasRecoveryBatch;
      hasRecoveryBatch = true;
      if (first) recoveryCodesRemaining = WHOLE_BATCH;
      return answer({ recoveryCodes: first ? RECOVERY : null });
    }

    if (method === 'POST' && path === '/mfa/recovery-codes') {
      const verdict = proves(body);
      if (verdict === 'none') return Promise.reject(refusal(403, 'MFA_REAUTHENTICATION_REQUIRED'));
      if (verdict === 'wrong') return Promise.reject(refusal(422, 'MFA_VERIFICATION_FAILED'));
      recoveryCodesRemaining = WHOLE_BATCH;
      return answer({ recoveryCodes: NEXT_RECOVERY });
    }

    if (method === 'DELETE' && path.startsWith('/mfa/')) {
      const id = decodeURIComponent(path.slice('/mfa/'.length));
      const target = methods.find((m) => m.id === id);
      if (target === undefined) return Promise.reject(refusal(404, 'MFA_METHOD_NOT_FOUND'));
      const confirmed = methods.filter((m) => m.confirmedAt !== null);
      const lastConfirmed = target.confirmedAt !== null && confirmed.length === 1;
      if (lastConfirmed) {
        const verdict = proves(body);
        if (verdict === 'none') return Promise.reject(refusal(403, 'MFA_REAUTHENTICATION_REQUIRED'));
        if (verdict === 'wrong') return Promise.reject(refusal(422, 'MFA_VERIFICATION_FAILED'));
      }
      methods = methods.filter((m) => m.id !== id);
      return answer(undefined);
    }

    if (method === 'POST' && path === '/mfa/webauthn/options') {
      // An enrollment: the session, and no challenge token in or out.
      enrollmentChallenge = true;
      return answer({ publicKey: PASSKEY_OPTIONS, challengeToken: null });
    }

    if (method === 'POST' && path === '/mfa/webauthn/verify') {
      const given = body as { response: { id?: string }; label?: string; proof?: unknown };
      // The route's own order: the label, then a missing proof (refused BEFORE
      // the challenge is spent, so that retry is good), then the challenge, then
      // the attestation, then a proof that was sent.
      if (String(given.label ?? '').trim() === '') {
        return Promise.reject(refusal(422, 'MFA_LABEL_REQUIRED'));
      }
      const owed = methods.some((m) => m.confirmedAt !== null);
      if (owed && proves(given.proof) === 'none') {
        return Promise.reject(refusal(403, 'MFA_REAUTHENTICATION_REQUIRED'));
      }
      if (!enrollmentChallenge) {
        // `MfaChallengeNotFoundError`, a domain error the filter's table does not
        // name: `422`, with no `code`, as the filter answers any such error.
        return Promise.reject(new ApiError(422, { error: 'Unprocessable Entity', message: 'Refused.' }));
      }
      enrollmentChallenge = false;
      // The enrollment branch is not flattened: a refused attestation is the
      // domain's own `422 MFA_VERIFICATION_FAILED`, as a wrong proof is.
      if (given.response.id !== GOOD_ATTESTATION.id) {
        return Promise.reject(refusal(422, 'MFA_VERIFICATION_FAILED'));
      }
      if (owed && proves(given.proof) === 'wrong') {
        return Promise.reject(refusal(422, 'MFA_VERIFICATION_FAILED'));
      }
      const added = { ...totp('method-key', String(given.label), true), type: MfaMethodType.WEBAUTHN };
      methods = [...methods, added];
      const first = !hasRecoveryBatch;
      hasRecoveryBatch = true;
      if (first) recoveryCodesRemaining = WHOLE_BATCH;
      return answer({ method: added, recoveryCodes: first ? RECOVERY : null });
    }

    return Promise.reject(new Error(`unmodelled: ${method} ${path}`));
  };

  return {
    client,
    requests,
    methods: () => methods,
    /** From the next call after \`succeeding\` more, \`VERB path\` answers 500. */
    breakAfter: (verb: string, path: string, succeeding = 0) => {
      breaking.set(`${verb} ${path}`, succeeding);
    },
    /** The requests of one kind, oldest first. */
    to: (verb: string, path: string) => (
      requests.filter((r) => r.method === verb && r.path === path)
    ),
  };
}

type Backend = ReturnType<typeof mfaBackend>;

/** Submits the form that holds `selector`; the page has several. */
async function submitFormOf(wrapper: VueWrapper, selector: string): Promise<void> {
  const form = wrapper.find(selector).element.closest('form');
  form?.dispatchEvent(new Event('submit', { cancelable: true }));
  await flushPromises();
}

/** A control found by its text. */
function button(wrapper: VueWrapper, key: string) {
  const found = wrapper.findAll('button').find((b) => b.text() === key);
  if (found === undefined) throw new Error(`no button ${key}; page has: ${wrapper.text()}`);
  return found;
}

describe('the security page, second factor', () => {
  let backend: Backend;

  async function open(initial: MfaMethodJSON[], remaining?: number): Promise<VueWrapper> {
    backend = mfaBackend(initial, remaining);
    useAuthStore().adoptTransport(backend.client);
    const wrapper = mount(SecurityPage, { global: mountOptions() });
    await flushPromises();
    return wrapper;
  }

  beforeEach(() => {
    stubAutoImports();
    setActivePinia(createPinia());
    window.history.replaceState(null, '');
    browser.attestation = null;
    browser.calls.length = 0;
    routing.guards.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('the list', () => {
    it('renders the methods the server lists, and says so when there are none', async () => {
      const some = await open([totp('m1', 'Phone', true)]);
      expect(some.text()).toContain('Phone');
      const none = await open([]);
      expect(none.text()).toContain('account.mfa.empty');
    });

    it('offers to add an authenticator app and, with no confirmed method, no new recovery codes', async () => {
      const wrapper = await open([totp('m1', 'Tablet', false)]);
      expect(wrapper.text()).toContain('account.mfa.addTotp');
      expect(wrapper.text()).not.toContain('account.mfa.regenerate');
    });
  });

  describe('the recovery codes that remain', () => {
    const LOW = '[data-test="recovery-codes-low"]';

    it('shows the count, and does not warn while there are plenty', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)], 9);
      expect(wrapper.text()).toContain('account.mfa.recoveryRemaining|{"count":9}');
      expect(wrapper.find(LOW).exists()).toBe(false);
    });

    it('warns when few remain', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)], 2);
      expect(wrapper.html()).toContain('2');
      expect(wrapper.find(LOW).exists()).toBe(true);
      expect(wrapper.find(LOW).text()).toContain('"count":2');
    });

    it('warns at the threshold, and not one above it', async () => {
      const at = await open([totp('m1', 'Phone', true)], 3);
      expect(at.find(LOW).exists()).toBe(true);
      const above = await open([totp('m1', 'Phone', true)], 4);
      expect(above.find(LOW).exists()).toBe(false);
    });

    it('says so, rather than showing nothing, when none remain', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)], 0);
      expect(wrapper.find(LOW).exists()).toBe(true);
      expect(wrapper.find(LOW).text()).toContain('account.mfa.recoveryNone');
      expect(wrapper.text()).toContain('account.mfa.recoveryRemaining|{"count":0}');
    });

    it('is not shown to an account with no confirmed method, which has no codes to count', async () => {
      const wrapper = await open([totp('m1', 'Tablet', false)], 0);
      expect(wrapper.find(LOW).exists()).toBe(false);
      expect(wrapper.text()).not.toContain('account.mfa.recoveryRemaining');
    });

    it('stops warning once a new batch is issued', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)], 1);
      expect(wrapper.find(LOW).exists()).toBe(true);
      await button(wrapper, 'account.mfa.regenerate').trigger('click');
      await wrapper.find('#proof-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#proof-code');
      await wrapper.find('#recovery-saved').setValue(true);
      await button(wrapper, 'account.mfa.recovery.done').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('account.mfa.recoveryRemaining|{"count":10}');
      expect(wrapper.find(LOW).exists()).toBe(false);
    });
  });

  describe('enrolling an authenticator app', () => {
    // The page has several forms; this picks the one holding the label field.
    async function submitLabel(wrapper: VueWrapper, label: string): Promise<void> {
      await wrapper.find('#totp-label').setValue(label);
      await submitFormOf(wrapper, '#totp-label');
    }

    it('shows the QR and the secret for manual entry', async () => {
      const wrapper = await open([]);
      await submitLabel(wrapper, 'Phone');
      const source = wrapper.find('img').attributes('src') ?? '';
      expect(decodeURIComponent(source.slice(source.indexOf(',') + 1))).toBe(QR);
      expect(wrapper.find('#totp-secret').text()).toBe(BASE32_SEED);
      expect(backend.to('POST', '/mfa/totp/enroll')[0]?.body).toEqual({ label: 'Phone' });
    });

    it('says the name is missing when it is, and shows no secret', async () => {
      const wrapper = await open([]);
      await submitLabel(wrapper, '   ');
      expect(wrapper.text()).toContain('account.mfa.labelMissing');
      expect(wrapper.find('#totp-secret').exists()).toBe(false);
    });

    it('says the code was wrong, keeps the secret on screen, and shows no recovery codes', async () => {
      const wrapper = await open([]);
      await submitLabel(wrapper, 'Phone');
      await wrapper.find('#totp-code').setValue(WRONG_CODE);
      await submitFormOf(wrapper, '#totp-code');
      expect(wrapper.text()).toContain('account.mfa.enroll.wrongCode');
      expect(wrapper.find('#totp-secret').text()).toBe(BASE32_SEED);
      expect(wrapper.find('#recovery-codes').exists()).toBe(false);
    });

    it('abandoning it drops the secret from the screen', async () => {
      const wrapper = await open([]);
      await submitLabel(wrapper, 'Phone');
      expect(wrapper.text()).toContain(BASE32_SEED);
      await button(wrapper, 'common.actions.cancel').trigger('click');
      await flushPromises();
      expect(wrapper.text()).not.toContain(BASE32_SEED);
      expect(wrapper.find('#totp-secret').exists()).toBe(false);
    });

    it('shows no recovery codes on a later confirmation, because the server returns none', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await submitLabel(wrapper, 'Second phone');
      await wrapper.find('#totp-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#totp-code');
      await wrapper.find('#proof-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#proof-code');
      expect(wrapper.find('#recovery-codes').exists()).toBe(false);
      expect(wrapper.text()).toContain('Second phone');
    });

    describe('adding a second factor costs a proof of the first', () => {
      const confirmBodies = (): unknown[] => backend.to('POST', '/mfa/totp/confirm').map((r) => r.body);
      const isConfirmed = (id: string): boolean => backend.methods()
        .some((m) => m.id === id && m.confirmedAt !== null);

      it('asks for no proof when it is the first factor, and sends none', async () => {
        const wrapper = await open([]);
        await submitLabel(wrapper, 'Phone');
        await wrapper.find('#totp-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#totp-code');

        expect(wrapper.find('#proof-code').exists()).toBe(false);
        expect(wrapper.find('#proof-recovery-code').exists()).toBe(false);
        expect(confirmBodies()).toEqual([{ methodId: 'method-new', code: RIGHT_CODE }]);
        expect(isConfirmed('method-new')).toBe(true);
      });

      it('does not confirm without a proof, and asks for one and says why instead of failing', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await submitLabel(wrapper, 'Attacker phone');
        await wrapper.find('#totp-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#totp-code');

        expect(isConfirmed('method-new')).toBe(false);
        expect(wrapper.find('#proof-code').exists()).toBe(true);
        expect(wrapper.text()).toContain('account.mfa.proof.requiredEnroll');
        expect(wrapper.text()).not.toContain('account.mfa.failed');
        expect(wrapper.text()).not.toContain('account.mfa.proof.wrong');
      });

      it('confirms when a proof from the existing method is given, sent nested under `proof`', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await submitLabel(wrapper, 'Second phone');
        await wrapper.find('#totp-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#totp-code');
        await wrapper.find('#proof-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#proof-code');

        expect(isConfirmed('method-new')).toBe(true);
        expect(confirmBodies()).toEqual([
          { methodId: 'method-new', code: RIGHT_CODE },
          { methodId: 'method-new', code: RIGHT_CODE, proof: { methodId: 'm1', code: RIGHT_CODE } },
        ]);
        expect(wrapper.find('#proof-code').exists()).toBe(false);
        expect(wrapper.find('#totp-secret').exists()).toBe(false);
      });

      it('accepts a recovery code as the proof', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await submitLabel(wrapper, 'Second phone');
        await wrapper.find('#totp-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#totp-code');
        await button(wrapper, 'account.mfa.proof.useRecovery').trigger('click');
        await wrapper.find('#proof-recovery-code').setValue(SPARE_RECOVERY);
        await submitFormOf(wrapper, '#proof-recovery-code');

        expect(isConfirmed('method-new')).toBe(true);
      });

      it('says a DIFFERENT thing when the proof was wrong, and confirms nothing', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await submitLabel(wrapper, 'Second phone');
        await wrapper.find('#totp-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#totp-code');
        await wrapper.find('#proof-code').setValue(WRONG_CODE);
        await submitFormOf(wrapper, '#proof-code');

        expect(isConfirmed('method-new')).toBe(false);
        expect(wrapper.text()).toContain('account.mfa.proof.wrong');
        expect(wrapper.text()).not.toContain('account.mfa.proof.requiredEnroll');
      });

      it('backing out of the proof returns to the enrollment, which can still be finished', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await submitLabel(wrapper, 'Second phone');
        await wrapper.find('#totp-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#totp-code');
        await button(wrapper, 'common.actions.cancel').trigger('click');
        await flushPromises();

        expect(wrapper.find('#totp-secret').text()).toBe(BASE32_SEED);
        expect(isConfirmed('method-new')).toBe(false);
      });
    });
  });

  describe('the recovery codes', () => {
    /** Enrols on an account with no methods, ending with the first batch on screen. */
    async function firstBatch(): Promise<VueWrapper> {
      const wrapper = await open([]);
      await wrapper.find('#totp-label').setValue('Phone');
      await submitFormOf(wrapper, '#totp-label');
      await wrapper.find('#totp-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#totp-code');
      return wrapper;
    }

    async function keepAndDismiss(wrapper: VueWrapper): Promise<void> {
      await wrapper.find('#recovery-saved').setValue(true);
      await button(wrapper, 'account.mfa.recovery.done').trigger('click');
      await flushPromises();
    }

    it('are shown on the first confirmation, with the statement that they will not be shown again', async () => {
      const wrapper = await firstBatch();
      for (const code of RECOVERY) expect(wrapper.text()).toContain(code);
      expect(wrapper.text()).toContain('account.mfa.recovery.showOnce');
    });

    it('are shown ONCE: after they are dismissed nothing on the page can show them again', async () => {
      const wrapper = await firstBatch();
      // The probe that makes the absence below mean something.
      expect(RECOVERY.every((code) => wrapper.text().includes(code))).toBe(true);

      await keepAndDismiss(wrapper);
      expect(wrapper.find('#recovery-codes').exists()).toBe(false);
      for (const code of RECOVERY) expect(wrapper.text()).not.toContain(code);
      expect(wrapper.html()).not.toContain(RECOVERY[0]);

      // Nothing to click for them, and a fresh mount of the page has no way to
      // have them: it reads only what the server lists, which holds none.
      expect(wrapper.text()).not.toContain('account.mfa.recovery.showOnce');
      const again = mount(SecurityPage, { global: mountOptions() });
      await flushPromises();
      for (const code of RECOVERY) expect(again.text()).not.toContain(code);
      const listed = JSON.stringify(backend.methods());
      for (const code of RECOVERY) expect(listed).not.toContain(code);
    });

    it('never reach the store, history.state, or the enrollment secret\'s storage', async () => {
      const wrapper = await firstBatch();
      expect(RECOVERY.every((code) => wrapper.text().includes(code))).toBe(true);

      // While they are on screen — the moment they exist at all.
      const pinia = getActivePinia() as { state: { value: unknown } };
      const held = JSON.stringify(pinia.state.value);
      const history = JSON.stringify(window.history.state);
      for (const code of RECOVERY) {
        expect(held).not.toContain(code);
        expect(history).not.toContain(code);
      }
      for (const storage of [window.localStorage, window.sessionStorage]) {
        const kept = JSON.stringify({ ...storage });
        for (const code of RECOVERY) expect(kept).not.toContain(code);
      }
      expect(held).not.toContain(BASE32_SEED);
    });

    it('the enrollment secret is in no store while it is on screen either', async () => {
      const wrapper = await open([]);
      await wrapper.find('#totp-label').setValue('Phone');
      await submitFormOf(wrapper, '#totp-label');
      expect(wrapper.text()).toContain(BASE32_SEED);
      const pinia = getActivePinia() as { state: { value: unknown } };
      expect(JSON.stringify(pinia.state.value)).not.toContain(BASE32_SEED);
      expect(JSON.stringify(window.history.state)).not.toContain(BASE32_SEED);
      const kept = JSON.stringify({ ...window.localStorage, ...window.sessionStorage });
      expect(kept).not.toContain(BASE32_SEED);
    });

    describe('leaving the page by a link', () => {
      /** The guard the page registered, called the way the router would. */
      const leave = (): unknown => routing.guards[routing.guards.length - 1]?.();

      it('is not interrupted when no codes are on screen', async () => {
        const confirm = vi.fn().mockReturnValue(false);
        vi.stubGlobal('confirm', confirm);
        await open([totp('m1', 'Phone', true)]);
        expect(routing.guards).toHaveLength(1);
        expect(leave()).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
      });

      it('asks while the codes are on screen and unkept, and a refusal keeps the person here', async () => {
        const confirm = vi.fn().mockReturnValue(false);
        vi.stubGlobal('confirm', confirm);
        await firstBatch();
        expect(leave()).toBe(false);
        expect(confirm).toHaveBeenCalledWith('account.mfa.recovery.leaveWarning');
      });

      it('lets the person go if they confirm', async () => {
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
        await firstBatch();
        expect(leave()).toBe(true);
      });

      it('does not ask once they have said they kept them', async () => {
        const confirm = vi.fn().mockReturnValue(false);
        vi.stubGlobal('confirm', confirm);
        const wrapper = await firstBatch();
        await wrapper.find('#recovery-saved').setValue(true);
        expect(leave()).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
      });

      it('asks again for the next batch: keeping the last one does not carry over', async () => {
        const confirm = vi.fn().mockReturnValue(false);
        vi.stubGlobal('confirm', confirm);
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await button(wrapper, 'account.mfa.regenerate').trigger('click');
        await wrapper.find('#proof-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#proof-code');
        await wrapper.find('#recovery-saved').setValue(true);
        await button(wrapper, 'account.mfa.recovery.done').trigger('click');
        await flushPromises();
        expect(leave()).toBe(true);

        await button(wrapper, 'account.mfa.regenerate').trigger('click');
        await wrapper.find('#proof-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#proof-code');
        expect(leave()).toBe(false);
      });
    });

    it('cannot be dismissed until the person says they have kept them', async () => {
      const wrapper = await firstBatch();
      await button(wrapper, 'account.mfa.recovery.done').trigger('click');
      expect(wrapper.find('#recovery-codes').exists()).toBe(true);
    });

    describe('regenerating', () => {
      it('asks for a proof first and says why, and sends none of its own', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await button(wrapper, 'account.mfa.regenerate').trigger('click');
        expect(wrapper.text()).toContain('account.mfa.proof.requiredRegenerate');
        expect(backend.to('POST', '/mfa/recovery-codes')).toHaveLength(0);
      });

      it('shows the new batch, once, after a right proof', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await button(wrapper, 'account.mfa.regenerate').trigger('click');
        await wrapper.find('#proof-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#proof-code');
        for (const code of NEXT_RECOVERY) expect(wrapper.text()).toContain(code);
        expect(wrapper.text()).toContain('account.mfa.recovery.showOnce');
        await keepAndDismiss(wrapper);
        for (const code of NEXT_RECOVERY) expect(wrapper.text()).not.toContain(code);
      });

      it('shows nothing on a wrong proof, and says it was wrong', async () => {
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await button(wrapper, 'account.mfa.regenerate').trigger('click');
        await wrapper.find('#proof-code').setValue(WRONG_CODE);
        await submitFormOf(wrapper, '#proof-code');
        expect(wrapper.text()).toContain('account.mfa.proof.wrong');
        expect(wrapper.find('#recovery-codes').exists()).toBe(false);
      });
    });
  });

  describe('removing a method', () => {
    async function submitProof(wrapper: VueWrapper, fieldId: string, value: string): Promise<void> {
      await wrapper.find(fieldId).setValue(value);
      await submitFormOf(wrapper, fieldId);
    }

    it('removes a method another confirmed one outlives with no proof, and sends none', async () => {
      const wrapper = await open([totp('m1', 'Phone', true), totp('m2', 'Tablet', true)]);
      await wrapper.findAll('tbody tr')[1]?.find('button').trigger('click');
      await flushPromises();
      expect(backend.methods().map((m) => m.id)).toEqual(['m1']);
      const [request] = backend.to('DELETE', '/mfa/m2');
      expect(request?.body).toBeUndefined();
      expect(wrapper.find('#proof-code').exists()).toBe(false);
    });

    it('removes an unfinished method with no proof either', async () => {
      const wrapper = await open([totp('m1', 'Phone', true), totp('m2', 'Tablet', false)]);
      await wrapper.findAll('tbody tr')[1]?.find('button').trigger('click');
      await flushPromises();
      expect(backend.methods().map((m) => m.id)).toEqual(['m1']);
    });

    it('asks for a proof when removing the last confirmed method, and says why rather than failing', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await wrapper.find('tbody tr button').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('account.mfa.proof.requiredRemove');
      expect(wrapper.text()).not.toContain('account.mfa.failed');
      expect(wrapper.text()).not.toContain('account.mfa.proof.wrong');
      expect(backend.methods().map((m) => m.id)).toEqual(['m1']);
    });

    it('removes it once a right code is given, sending exactly a method and its code', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await wrapper.find('tbody tr button').trigger('click');
      await flushPromises();
      await submitProof(wrapper, '#proof-code', RIGHT_CODE);

      expect(backend.methods()).toEqual([]);
      const requests = backend.to('DELETE', '/mfa/m1');
      expect(requests).toHaveLength(2);
      expect(requests[0]?.body).toBeUndefined();
      expect(requests[1]?.body).toEqual({ methodId: 'm1', code: RIGHT_CODE });
      expect(wrapper.find('#proof-code').exists()).toBe(false);
    });

    it('removes it once an unused recovery code is given, sending that and nothing else', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await wrapper.find('tbody tr button').trigger('click');
      await flushPromises();
      await button(wrapper, 'account.mfa.proof.useRecovery').trigger('click');
      await submitProof(wrapper, '#proof-recovery-code', SPARE_RECOVERY);

      expect(backend.methods()).toEqual([]);
      expect(backend.to('DELETE', '/mfa/m1')[1]?.body).toEqual({ recoveryCode: SPARE_RECOVERY });
    });

    it('says a DIFFERENT thing when the proof was wrong, and keeps the method', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await wrapper.find('tbody tr button').trigger('click');
      await flushPromises();
      const explanation = wrapper.text();
      await submitProof(wrapper, '#proof-code', WRONG_CODE);

      expect(wrapper.text()).toContain('account.mfa.proof.wrong');
      expect(wrapper.text()).not.toContain('account.mfa.proof.requiredRemove');
      expect(wrapper.text()).not.toBe(explanation);
      expect(backend.methods().map((m) => m.id)).toEqual(['m1']);
    });

    it('backing out leaves the method where it was', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await wrapper.find('tbody tr button').trigger('click');
      await flushPromises();
      await button(wrapper, 'common.actions.cancel').trigger('click');
      await flushPromises();
      expect(wrapper.find('#proof-code').exists()).toBe(false);
      expect(wrapper.text()).toContain('Phone');
      expect(backend.methods()).toHaveLength(1);
    });
  });

  describe('enrolling a passkey', () => {
    async function addPasskey(wrapper: VueWrapper, label = 'Office key'): Promise<void> {
      await wrapper.find('#passkey-label').setValue(label);
      await submitFormOf(wrapper, '#passkey-label');
    }

    it('fetches the options, hands the browser exactly what the server sent, posts the attestation back, and lists it', async () => {
      browser.attestation = GOOD_ATTESTATION;
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await addPasskey(wrapper);
      // The account already holds a factor, so the server asks for a proof of it.
      await wrapper.find('#proof-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#proof-code');

      expect(browser.calls).toEqual([{ optionsJSON: PASSKEY_OPTIONS }]);
      const [options] = backend.to('POST', '/mfa/webauthn/options');
      // A session and no challenge: the route decides the ceremony from that.
      expect(options?.body).toEqual({});
      const [verify] = backend.to('POST', '/mfa/webauthn/verify').slice(-1);
      expect(verify?.body).toMatchObject({ response: GOOD_ATTESTATION, label: 'Office key' });
      expect(wrapper.text()).toContain('Office key');
      expect(wrapper.text()).toContain('account.mfa.typeWebauthn');
      expect(wrapper.text()).not.toContain('account.mfa.failed');
    });

    it('shows the first recovery batch when the passkey is the first method, once', async () => {
      browser.attestation = GOOD_ATTESTATION;
      const wrapper = await open([]);
      await addPasskey(wrapper);
      for (const code of RECOVERY) expect(wrapper.text()).toContain(code);
      expect(wrapper.text()).toContain('account.mfa.recovery.showOnce');
    });

    it('says the prompt was dismissed when the person cancels it, and sends nothing', async () => {
      // `browser.attestation` stays null: the library rejects, as it does for a
      // closed prompt, a timeout or an authenticator that declined.
      const wrapper = await open([totp('m1', 'Phone', true)]);
      await addPasskey(wrapper);

      expect(browser.calls).toHaveLength(1);
      expect(wrapper.text()).toContain('account.mfa.passkeyDismissed');
      // Not the generic failure, and not the library's own words.
      expect(wrapper.text()).not.toContain('account.mfa.failed');
      expect(wrapper.text()).not.toContain('timed out or was not allowed');
      expect(backend.to('POST', '/mfa/webauthn/verify')).toHaveLength(0);
      expect(backend.methods().map((m) => m.id)).toEqual(['m1']);
      // The page is usable again: not stuck loading.
      const submit = wrapper.find('#passkey-label').element.closest('form')?.querySelector('button');
      expect(submit?.hasAttribute('disabled')).toBe(false);
    });

    it('says it could not add it when the server refuses the attestation, and lists nothing new', async () => {
      browser.attestation = { id: 'attestation-forged', type: 'public-key' };
      const wrapper = await open([totp('m1', 'Phone', false)]);
      await addPasskey(wrapper);

      expect(backend.to('POST', '/mfa/webauthn/verify')).toHaveLength(1);
      expect(wrapper.text()).toContain('account.mfa.failed');
      expect(wrapper.text()).not.toContain('account.mfa.passkeyDismissed');
      expect(wrapper.text()).not.toContain('Office key');
      expect(backend.methods().map((m) => m.id)).toEqual(['m1']);
    });

    describe('adding a second factor costs a proof of the first', () => {
      const verifyBodies = (): unknown[] => backend.to('POST', '/mfa/webauthn/verify').map((r) => r.body);
      const hasKey = (): boolean => backend.methods().some((m) => m.id === 'method-key');

      it('asks for no proof when the passkey is the first factor', async () => {
        browser.attestation = GOOD_ATTESTATION;
        const wrapper = await open([]);
        await addPasskey(wrapper);

        expect(wrapper.find('#proof-code').exists()).toBe(false);
        expect(verifyBodies()).toEqual([{ response: GOOD_ATTESTATION, label: 'Office key' }]);
        expect(hasKey()).toBe(true);
      });

      it('does not register without a proof, and asks for one and says why instead of failing', async () => {
        browser.attestation = GOOD_ATTESTATION;
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await addPasskey(wrapper);

        expect(hasKey()).toBe(false);
        expect(wrapper.find('#proof-code').exists()).toBe(true);
        expect(wrapper.text()).toContain('account.mfa.proof.requiredEnroll');
        expect(wrapper.text()).not.toContain('account.mfa.failed');
      });

      it('registers with a proof, and the person touches the key only once', async () => {
        browser.attestation = GOOD_ATTESTATION;
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await addPasskey(wrapper);
        await wrapper.find('#proof-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#proof-code');

        expect(hasKey()).toBe(true);
        // The ceremony already performed is carried to the retry, not repeated.
        expect(browser.calls).toHaveLength(1);
        expect(verifyBodies()).toEqual([
          { response: GOOD_ATTESTATION, label: 'Office key' },
          {
            response: GOOD_ATTESTATION,
            label: 'Office key',
            proof: { methodId: 'm1', code: RIGHT_CODE },
          },
        ]);
        expect(wrapper.find('#proof-code').exists()).toBe(false);
      });

      it('after a wrong proof drops the ceremony and says to touch the key again, rather than resending it', async () => {
        browser.attestation = GOOD_ATTESTATION;
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await addPasskey(wrapper);
        await wrapper.find('#proof-code').setValue(WRONG_CODE);
        await submitFormOf(wrapper, '#proof-code');

        expect(hasKey()).toBe(false);
        // The route spent the ceremony's challenge before it judged the proof, so
        // the same attestation can never succeed: it must not be offered again.
        expect(wrapper.find('#proof-code').exists()).toBe(false);
        expect(wrapper.text()).toContain('account.mfa.passkeyRestart');
        expect(wrapper.text()).not.toContain('account.mfa.failed');
        expect(verifyBodies()).toHaveLength(2);

        // And starting over works: a new ceremony, a new challenge, a right proof.
        await addPasskey(wrapper);
        await wrapper.find('#proof-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#proof-code');
        expect(browser.calls).toHaveLength(2);
        expect(hasKey()).toBe(true);
        expect(wrapper.text()).not.toContain('account.mfa.passkeyRestart');
      });

      it('keeps the ceremony across a MISSING proof, which is refused before the challenge is spent', async () => {
        browser.attestation = GOOD_ATTESTATION;
        const wrapper = await open([totp('m1', 'Phone', true)]);
        await addPasskey(wrapper);
        expect(wrapper.find('#proof-code').exists()).toBe(true);
        await wrapper.find('#proof-code').setValue(RIGHT_CODE);
        await submitFormOf(wrapper, '#proof-code');

        expect(browser.calls).toHaveLength(1);
        expect(hasKey()).toBe(true);
      });
    });

    it('says the name is missing when it is blank, and adds nothing', async () => {
      browser.attestation = GOOD_ATTESTATION;
      const wrapper = await open([]);
      await addPasskey(wrapper, '   ');
      expect(wrapper.text()).toContain('account.mfa.labelMissing');
      expect(backend.methods()).toEqual([]);
    });
  });

  describe('containment', () => {
    // WHAT WAS CHECKED BY HAND, in a real build driven in a browser: the server
    // render of this page carries pinia's auth user and nothing of the second
    // factor; with the secret and codes on screen, Pinia, `history.state`,
    // storage and cookies held neither; every request's `Referer` was the origin
    // alone. WHAT IS GUARDED HERE: Pinia, `history.state` and storage (above),
    // and, below, the change that would put this data in the server payload or in
    // shared state. The `Referer` observation is not guarded: the page loads
    // nothing cross-origin, which is a property of the markup, not of anything
    // asserted.

    /** Every file the secret or the codes are held, rendered or carried by. */
    const FILES = [
      '../../composables/useMfaMethods.ts',
      '../../services/mfa.service.ts',
      '../../fetchers/mfa.fetchers.ts',
      '../account/security.vue',
      '../../components/organisms/TotpEnrollment.vue',
      '../../components/organisms/RecoveryCodesPanel.vue',
      '../../components/organisms/MfaProofForm.vue',
      '../../components/organisms/MfaMethodList.vue',
    ];

    /** Anything that puts a value in the server payload, shared state, a cookie, or raw markup. */
    const FORBIDDEN
      = /\b(?:use(?:Lazy)?(?:AsyncData|Fetch)|useNuxtData|useNuxtApp|payload|callOnce|useState|useCookie)\b|v-html/;

    it('nothing that holds, renders or carries them uses a mechanism Nuxt serialises or shares', () => {
      for (const file of FILES) {
        const source = readFileSync(resolve(import.meta.dirname, file), 'utf8')
          // Comments may name them, to say they are not used.
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        expect({ file, found: FORBIDDEN.exec(source)?.[0] ?? null }).toEqual({ file, found: null });
      }
    });
  });

  describe('a failure the screen has no name for is shown on every step, not only on the list', () => {
    /** Enrols to the point where the confirmation form is up. */
    async function enrolling(initial: MfaMethodJSON[] = []): Promise<VueWrapper> {
      const wrapper = await open(initial);
      await wrapper.find('#totp-label').setValue('Phone');
      await submitFormOf(wrapper, '#totp-label');
      return wrapper;
    }

    it('confirming an authenticator app', async () => {
      const wrapper = await enrolling();
      backend.breakAfter('POST', '/mfa/totp/confirm');
      await wrapper.find('#totp-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#totp-code');

      expect(wrapper.find('#totp-secret').exists()).toBe(true);
      expect(wrapper.text()).toContain('account.mfa.failed');
      expect(wrapper.text()).not.toContain('account.mfa.enroll.wrongCode');
    });

    it('submitting a proof to remove the last method', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      backend.breakAfter('DELETE', '/mfa/m1', 1);
      await wrapper.find('tbody tr button').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('account.mfa.proof.requiredRemove');
      await wrapper.find('#proof-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#proof-code');

      expect(wrapper.find('#proof-code').exists()).toBe(true);
      expect(wrapper.text()).toContain('account.mfa.failed');
      expect(wrapper.text()).not.toContain('account.mfa.proof.wrong');
    });

    it('submitting a proof to get new recovery codes', async () => {
      const wrapper = await open([totp('m1', 'Phone', true)]);
      backend.breakAfter('POST', '/mfa/recovery-codes');
      await button(wrapper, 'account.mfa.regenerate').trigger('click');
      await wrapper.find('#proof-code').setValue(RIGHT_CODE);
      await submitFormOf(wrapper, '#proof-code');

      expect(wrapper.find('#proof-code').exists()).toBe(true);
      expect(wrapper.text()).toContain('account.mfa.failed');
      expect(wrapper.find('#recovery-codes').exists()).toBe(false);
    });

    it('starting an enrollment', async () => {
      const wrapper = await open([]);
      backend.breakAfter('POST', '/mfa/totp/enroll');
      await wrapper.find('#totp-label').setValue('Phone');
      await submitFormOf(wrapper, '#totp-label');
      expect(wrapper.text()).toContain('account.mfa.failed');
      expect(wrapper.find('#totp-secret').exists()).toBe(false);
    });

    it('and backing out of the step takes the stale error away', async () => {
      const enrol = await enrolling();
      backend.breakAfter('POST', '/mfa/totp/confirm');
      await enrol.find('#totp-code').setValue(RIGHT_CODE);
      await submitFormOf(enrol, '#totp-code');
      expect(enrol.text()).toContain('account.mfa.failed');
      await button(enrol, 'common.actions.cancel').trigger('click');
      await flushPromises();
      expect(enrol.text()).not.toContain('account.mfa.failed');

      const proof = await open([totp('m1', 'Phone', true)]);
      backend.breakAfter('DELETE', '/mfa/m1', 1);
      await proof.find('tbody tr button').trigger('click');
      await flushPromises();
      await proof.find('#proof-code').setValue(RIGHT_CODE);
      await submitFormOf(proof, '#proof-code');
      expect(proof.text()).toContain('account.mfa.failed');
      await button(proof, 'common.actions.cancel').trigger('click');
      await flushPromises();
      expect(proof.text()).not.toContain('account.mfa.failed');
    });
  });

  describe('when the server fails', () => {
    it('says it could not read the list, and invents no rows', async () => {
      backend = mfaBackend([totp('m1', 'Phone', true)]);
      const failing: ApiClient = <T>(request: ApiRequest): Promise<T> => (
        request.path === '/mfa/methods'
          ? Promise.reject(new Error('down'))
          : backend.client<T>(request)
      );
      useAuthStore().adoptTransport(failing);
      const wrapper = mount(SecurityPage, { global: mountOptions() });
      await flushPromises();
      expect(wrapper.text()).toContain('account.mfa.failed');
      expect(wrapper.findAll('tbody tr')).toHaveLength(0);
    });
  });
});
