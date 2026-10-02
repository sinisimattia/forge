import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import type { ApiClient, ApiRequest } from '~/types';
import LoginForm from '../organisms/LoginForm.vue';
import { mountOptions, stubAutoImports } from './harness';

/**
 * The sign-in form, driven through the real chain — the shipped store, its real
 * `AuthHttpService`, its real fetchers — against a model of the backend. Only
 * the transport underneath is replaced, through the same door the server plugin
 * uses in production.
 *
 * ## The assertion this file exists for
 *
 * `does NOT show a different message for a different failure` drives three
 * genuinely different failures and asserts the rendered text is identical. It is
 * the client half of the enumeration property the backend spends real effort on:
 * sign-in answers the same however it failed, so nobody can test an address for
 * existence one attempt at a time — and a screen that said "no account with that
 * address" for one and "incorrect password" for another would republish, in
 * prose, exactly what the status line withholds.
 *
 * The three are not variations of one path. Two are refusals the world produces
 * (an address nothing answers to; an address something answers to, with the
 * wrong secret) and the third is a transport that never reaches a backend at
 * all — which in the component is a different branch, the `catch`. A form that
 * differentiated any of them would fail here.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';

/**
 * The same phrase, spoilt, for the attempt that has to be refused.
 *
 * A named binding rather than a literal at its use: it is built from
 * `PLAINTEXT`, so the correct phrase has one spelling and this one is visibly
 * derived from it.
 */
const WRONG_PLAINTEXT = `${PLAINTEXT}-not`;

const SEEDED_AT = '2026-01-01T00:00:00.000Z';

/** `example.test` is reserved by RFC 6761 and resolves for nobody. */
const ACTOR_EMAIL = 'ada@example.test';
const UNKNOWN_EMAIL = 'nobody@example.test';

const ACTOR: UserJSON = {
  id: 'stub-User-1' as UserId,
  email: ACTOR_EMAIL,
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

describe('LoginForm', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubAutoImports();
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    useAuthStore().adoptTransport(backend.client);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Fills the form, submits it, and lets everything it started settle. */
  async function signIn(email: string, secret: string) {
    const wrapper = mount(LoginForm, { global: mountOptions() });
    await wrapper.find('#sign-in-email').setValue(email);
    await wrapper.find('#sign-in-secret').setValue(secret);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    return wrapper;
  }

  it('submits the normalized address and the secret', async () => {
    // What was *sent*, read off the wire, and not what the component says it
    // sent. The stub normalizes on lookup, so a sign-in with a padded,
    // mixed-case address succeeds whether or not the form normalizes anything —
    // an assertion about the outcome would pass for a form that sent the string
    // as typed. Only the recorded request can tell the two apart.
    const seen: ApiRequest[] = [];
    const recording: ApiClient = <T>(request: ApiRequest): Promise<T> => {
      seen.push(request);
      return backend.client<T>(request);
    };
    useAuthStore().adoptTransport(recording);

    const wrapper = await signIn(`  ADA@Example.TEST  `, PLAINTEXT);

    expect(wrapper.emitted('authenticated')).toHaveLength(1);
    const sent = seen.filter((one) => one.path === '/auth/login')[0]?.body as {
      email: string;
      secret: string;
    };
    expect(sent.email).toBe(ACTOR_EMAIL);
    expect(sent.secret).toBe(PLAINTEXT);
  });

  it('hands a pending second factor to the page, and is neither a session nor a failure', async () => {
    // The third arm of the outcome switch. A form that folded `MFA_REQUIRED` into
    // `AUTHENTICATED` would announce a session that does not exist; one that folded it into
    // `REJECTED` would tell a person who typed the right password that they did not.
    backend.requireSecondFactor(ACTOR.id, {
      methods: [{ id: 'method-1', type: 'TOTP', label: 'Phone', code: '123456' }],
    });

    const wrapper = await signIn(ACTOR_EMAIL, PLAINTEXT);

    expect(wrapper.emitted('challenged')).toHaveLength(1);
    expect(wrapper.emitted('authenticated')).toBeUndefined();
    expect(wrapper.text()).not.toContain('auth.signIn.failed');
  });

  it('shows the single fixed failure message on rejection', async () => {
    const wrapper = await signIn(ACTOR_EMAIL, WRONG_PLAINTEXT);
    expect(wrapper.text()).toContain('auth.signIn.failed');
    expect(wrapper.emitted('authenticated')).toBeUndefined();
  });

  it('does NOT show the failure message before anything has been tried', () => {
    // Without this, a form that renders the alert unconditionally passes the
    // assertion above and every identical-text assertion below.
    const wrapper = mount(LoginForm, { global: mountOptions() });
    expect(wrapper.text()).not.toContain('auth.signIn.failed');
  });

  it('does NOT show a different message for a different failure', async () => {
    // Three failures that differ in every way the component could notice: an
    // address nothing answers to, an address something answers to with the wrong
    // secret, and a transport that never reaches a backend (a `catch`, not a
    // rejection). The rendered **markup** must be identical, byte for byte.
    //
    // `html()` and not `text()`, and the difference is the whole assertion.
    // `text()` is `textContent`: it discards every attribute. `AppAlert` is a
    // single-root element, so anything put on `<AppAlert>` falls through onto it
    // — and four differentiators with byte-identical text all passed this suite
    // while it compared `text()`: `:title`, `:aria-live`, `:class` and
    // `:data-failure`. The `title` one is a native tooltip that assistive
    // technology reads aloud, so it republishes in prose exactly what the
    // backend's identical `401` withholds; the `aria-live` one arrives looking
    // like an accessibility improvement. Both are likelier regressions than a
    // second message, precisely because both look like kindnesses.
    const rendered: string[] = [];

    rendered.push((await signIn(UNKNOWN_EMAIL, PLAINTEXT)).html());
    rendered.push((await signIn(ACTOR_EMAIL, WRONG_PLAINTEXT)).html());

    const unreachable: ApiClient = () => Promise.reject(new Error('the backend is not there'));
    useAuthStore().adoptTransport(unreachable);
    rendered.push((await signIn(ACTOR_EMAIL, PLAINTEXT)).html());

    // Each one really did fail — otherwise three identical *success* screens
    // would satisfy the comparison below.
    for (const markup of rendered) expect(markup).toContain('auth.signIn.failed');
    expect(new Set(rendered).size).toBe(1);
  });

  it('disables submit while in flight, and re-enables after failure', async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: ApiClient = async <T>(request: ApiRequest): Promise<T> => {
      await held;
      return backend.client<T>(request);
    };
    useAuthStore().adoptTransport(slow);

    const wrapper = mount(LoginForm, { global: mountOptions() });
    await wrapper.find('#sign-in-email').setValue(ACTOR_EMAIL);
    await wrapper.find('#sign-in-secret').setValue(WRONG_PLAINTEXT);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined();

    release();
    await flushPromises();

    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('auth.signIn.failed');
  });

  it('does NOT disable submit before anything is in flight', () => {
    // The other half: a form whose submit is always disabled passes the first
    // assertion above, and cannot be used at all.
    const wrapper = mount(LoginForm, { global: mountOptions() });
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined();
  });
});
