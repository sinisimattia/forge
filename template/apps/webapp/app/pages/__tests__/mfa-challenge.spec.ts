import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import type { Pinia } from 'pinia';
import type { Component } from 'vue';
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import {
  mountOptions,
  navigations,
  route,
  stubAutoImports,
} from '~/components/__tests__/harness';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import type { ApiClient, ApiRequest, LoginResponseBody } from '~/types';
import { MFA_CHALLENGE_PATH } from '~/utils/redirect';
import LoginPage from '../login.vue';
import ChallengePage from '../mfa/challenge.vue';

/**
 * What the browser's passkey library does, decided per test.
 *
 * Hoisted because `vi.mock` is: the factory runs before any import, and a plain
 * `const` would not exist yet.
 */
const browser = vi.hoisted(() => ({
  supported: true,
  refuse: false,
  assertion: { id: 'stub-passkey-1' } as Record<string, unknown>,
}));

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => browser.supported,
  startAuthentication: vi.fn(async () => {
    if (browser.refuse) throw new Error('The operation either timed out or was not allowed.');
    return browser.assertion;
  }),
}));

/**
 * The challenge page, and — the reason this file exists — the place it is
 * reached from.
 *
 * ## The meeting point
 *
 * A federated callback page once rendered all seven of its refusal messages
 * correctly while the redirect that was supposed to land on it sent the browser
 * somewhere else, so the message behind that phase's central security property
 * was displayed nowhere. It was invisible because the page's spec asserted the
 * page, the controller's spec asserted the redirect, and nothing asserted that
 * they met.
 *
 * `the meeting point` below is that assertion, twice over. The password door is
 * driven through the **real sign-in page**: a login the backend answers with
 * `MFA_REQUIRED` is submitted, whatever path the page then navigates to is
 * resolved against **the page files that exist** (the way Nuxt derives a route
 * from a file name, not from a constant either side declares), and the page it
 * lands on is mounted with the state the sign-in left behind. The federated door
 * cannot be driven from here — the redirect is the backend's — so the backend's
 * own source is read for the path and the parameter it emits, and both are held
 * against the page.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';
const ACTOR_ID = 'stub-User-1' as UserId;

const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

const AUTHENTICATOR_ID = 'stub-method-totp';
const AUTHENTICATOR_ANSWER = '123456';
const WRONG_ANSWER = '654321';
const RECOVERY_ANSWER = 'stub-recovery-1';
/** Of the right shape and naming nothing the world minted. */
const UNKNOWN_CHALLENGE = 'stub-challenge-unknown';

/** Where the browser is, as far as `window.location` is concerned. */
const ORIGIN = 'http://localhost:3001';

/**
 * Every page file, as Nuxt would route it: `pages/mfa/challenge.vue` is
 * `/mfa/challenge`, and `pages/index.vue` is `/`.
 */
const PAGES = (() => {
  const modules = import.meta.glob('../**/*.vue', { eager: true }) as Record<string, { default: Component }>;
  const routed = new Map<string, Component>();
  for (const [file, module] of Object.entries(modules)) {
    const withoutRoot = file.slice('../'.length, -'.vue'.length);
    const path = `/${withoutRoot}`.replace(/\/index$/, '') || '/';
    routed.set(path, module.default);
  }
  return routed;
})();

/** `/mfa/challenge?redirectTo=%2Fx` as a path and a query object. */
function parse(target: string): { path: string; query: Record<string, string> } {
  const url = new URL(target, ORIGIN);
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
}

/**
 * The `history.state` vue-router leaves on an entry it navigated to, with the
 * shape it was read back in from a real browser: `current` carries the query,
 * unencoded slashes and all.
 */
function routerStateFor(token: string, extra: string): Record<string, unknown> {
  const tail = extra === '' ? '' : '&redirectTo=/account/sessions';
  return {
    back: null,
    current: `/mfa/challenge?challengeToken=${token}${tail}`,
    forward: null,
    position: 1,
    replaced: true,
    scroll: false,
  };
}

/** Moves the address bar, which `window.location` reads back. */
function visit(pathAndQuery: string): void {
  (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(`${ORIGIN}${pathAndQuery}`);
}

describe('the challenge page', () => {
  let backend: StubBackend;
  /** The challenge tokens the world answered logins with, read off the wire. */
  let tokens: string[];

  function tapped(): ApiClient {
    return async <T>(request: ApiRequest): Promise<T> => {
      const answer = await backend.client<T>(request);
      const body = answer as unknown as LoginResponseBody | undefined;
      if (body !== undefined && body.status === AuthenticationStatus.MFA_REQUIRED) {
        tokens.push(body.challengeToken);
      }
      return answer;
    };
  }

  beforeEach(() => {
    stubAutoImports();
    browser.supported = true;
    browser.refuse = false;
    tokens = [];
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    backend.requireSecondFactor(ACTOR_ID, {
      methods: [
        { id: AUTHENTICATOR_ID, type: 'TOTP', label: 'Phone', code: AUTHENTICATOR_ANSWER },
        { id: 'stub-method-key', type: 'WEBAUTHN', label: 'Key', code: 'stub-passkey-1' },
      ],
      recoveryCodes: [RECOVERY_ANSWER],
    });
    useAuthStore().adoptTransport(tapped());
    visit('/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Submits the sign-in page with the second-factor account's own credentials. */
  async function signInThroughTheLoginPage(query: Record<string, unknown> = {}): Promise<void> {
    route.query = query;
    const wrapper = mount(LoginPage, { global: mountOptions() });
    await wrapper.find('#sign-in-email').setValue(ACTOR.email);
    await wrapper.find('#sign-in-secret').setValue(PLAINTEXT);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
  }

  async function mountChallenge(
    query: Record<string, unknown> = {},
  ): Promise<ReturnType<typeof mount>> {
    route.query = query;
    const wrapper = mount(ChallengePage, { global: mountOptions() });
    await flushPromises();
    return wrapper;
  }

  describe('the meeting point', () => {
    it('lands a login the backend answered MFA_REQUIRED on a page that exists, and that page renders', async () => {
      await signInThroughTheLoginPage();

      // The real handler navigated somewhere, and it was not asked to go home.
      expect(navigations).toHaveLength(1);
      const { path, query } = parse(navigations[0] ?? '');
      expect(path).toBe('/mfa/challenge');

      // The join: the route is resolved against the page FILES, so a page moved
      // or renamed leaves this red even though the login page still says the old
      // path and every constant still agrees with itself.
      const landing = PAGES.get(path);
      expect(landing).toBeDefined();
      expect(landing).toBe(ChallengePage);

      // And the page the browser arrives at, with the state the sign-in left
      // behind, is the form — not a bounce back to sign in for want of a
      // challenge, which is what a page that could not see the login's state
      // would do.
      navigations.length = 0;
      route.query = query;
      const arrived = mount(landing as Component, { global: mountOptions() });
      await flushPromises();
      expect(navigations).toEqual([]);
      expect(arrived.find('#mfa-code').exists()).toBe(true);
    });

    it('carries the destination the sign-in was headed for, under the name the backend gives it', async () => {
      await signInThroughTheLoginPage({ redirect: '/account/sessions' });

      const { path, query } = parse(navigations[0] ?? '');
      expect(path).toBe('/mfa/challenge');
      expect(query).toEqual({ redirectTo: '/account/sessions' });
    });

    it('does NOT carry a destination that is not in this application', async () => {
      await signInThroughTheLoginPage({ redirect: '//elsewhere.example/x' });

      expect(navigations).toEqual(['/mfa/challenge']);
    });

    it('is the path the shipped constant names, and a page file exists at it', () => {
      expect(MFA_CHALLENGE_PATH).toBe('/mfa/challenge');
      expect(PAGES.has(MFA_CHALLENGE_PATH)).toBe(true);
    });

    // The federated door: the redirect is the backend's, so what can be held
    // against the page is what the backend's source says it emits.
    //
    // **Skipped, not failed, when the backend is not in the tree.** A generated
    // project can be adopted into a repository that does not carry
    // `apps/backend`, and a webapp suite cannot assert a claim about another
    // package in a tree where that package is gone. Skipping is the honest
    // answer: the claim is unverifiable there, not false. It is not a silent hole
    // where the backend IS present — the two tests below run whenever the file
    // exists, and each asserts that its patterns matched before it compares
    // anything, so a backend that moved the line fails loudly rather than
    // passing on `undefined === undefined`.
    const backendFile = (...parts: string[]): string => resolve(
      process.cwd(),
      '..',
      'backend',
      'src',
      ...parts,
    );
    const backendPresent = existsSync(backendFile('auth', 'oauth', 'oauth.controller.ts'))
      && existsSync(backendFile('auth', 'auth.controller.ts'));

    it.skipIf(!backendPresent)(
      'is where the backend redirects a federated sign-in, with the parameter this page reads',
      () => {
        const controller = readFileSync(backendFile('auth', 'oauth', 'oauth.controller.ts'), 'utf8');

        // Scoped to the two places that matter, not to the file: the callback's
        // landing builder sets `redirectTo` too, and a pattern that matches
        // anywhere proves a line exists, not that the MFA redirect uses it.
        const start = controller.indexOf('private challengeUrl(');
        expect(start).toBeGreaterThan(-1);
        const redirect = controller.slice(start, controller.indexOf('\n  }\n', start));
        const emittedPath = /new URL\((\w+), this\.webappUrl\)/.exec(redirect)?.[1];
        const emittedParameter = /searchParams\.set\('(challengeToken)', challengeToken\)/
          .exec(redirect)?.[1];
        const emittedDestination = /searchParams\.set\('(redirectTo)', path\)/.exec(redirect)?.[1];
        const pathValue = new RegExp(`const ${emittedPath ?? '\\0'} = '([^']+)'`)
          .exec(controller)?.[1];

        // And the callback's `MFA_REQUIRED` arm is what returns it, with no other
        // arm in between.
        const arm = /case 'MFA_REQUIRED':([\s\S]*?)case '/.exec(controller)?.[1] ?? '';
        expect(arm).toContain('return this.challengeUrl(');

        // Each regular expression must have found its line, or this compares
        // `undefined` with `undefined` and passes for a file that says nothing.
        expect(emittedPath).toBe('MFA_CHALLENGE_PATH');
        expect(emittedParameter).toBeDefined();
        expect(emittedDestination).toBeDefined();
        expect(pathValue).toBeDefined();

        expect(PAGES.has(pathValue ?? '')).toBe(true);
        expect(PAGES.get(pathValue ?? '')).toBe(ChallengePage);

        const page = readFileSync(resolve(process.cwd(), 'app', 'pages', 'mfa', 'challenge.vue'), 'utf8');
        expect(page).toContain(`'${emittedParameter}'`);
        expect(page).toContain(`route.query.${emittedDestination}`);
      },
    );

    // The read that gives a token-only arrival its method list. The fetcher's
    // path is a literal in this app and the route is a decorator in the other;
    // this holds one against the other.
    it.skipIf(!backendPresent)('asks the route the backend serves for a challenge\'s methods', () => {
      const controller = readFileSync(backendFile('auth', 'auth.controller.ts'), 'utf8');
      const prefix = /@Controller\('([^']*)'\)/.exec(controller)?.[1];
      const served = /@Post\('(mfa\/methods)'\)/.exec(controller)?.[1];
      expect(prefix).toBeDefined();
      expect(served).toBeDefined();

      const fetcher = readFileSync(
        resolve(process.cwd(), 'app', 'fetchers', 'auth.fetchers.ts'),
        'utf8',
      );
      expect(fetcher).toContain(`path: '/${prefix}/${served}'`);
    });
  });

  describe('the challenge token in the address', () => {
    async function arriveFederated(extra = ''): Promise<{ token: string; wrapper: ReturnType<typeof mount> }> {
      const token = backend.mintChallenge(ACTOR_ID);
      visit(`/mfa/challenge?challengeToken=${token}${extra}`);
      // What the router wrote for this entry, as observed in a real build: `current`
      // is the full path, query included. A synthetic state without it would make
      // every assertion about the state pass with or without the leak.
      window.history.replaceState(routerStateFor(token, extra), '');
      const wrapper = await mountChallenge({
        challengeToken: token,
        ...(extra === '' ? {} : { redirectTo: '/account/sessions' }),
      });
      return { token, wrapper };
    }

    it('is taken out of the address bar on arrival', async () => {
      const { token } = await arriveFederated();

      expect(window.location.href).not.toContain(token);
      expect(window.location.search).not.toContain('challengeToken');
    });

    it('is removed by rewriting the entry, not by adding one', async () => {
      const before = window.history.length;
      const replace = vi.spyOn(window.history, 'replaceState');
      const push = vi.spyOn(window.history, 'pushState');

      await arriveFederated();

      // The fixture's own call to install the router's state passes no URL; the
      // page's is the one that rewrites it, and there is exactly one.
      expect(replace.mock.calls.filter((call) => typeof call[2] === 'string')).toHaveLength(1);
      expect(push).not.toHaveBeenCalled();
      expect(window.history.length).toBe(before);
    });

    it('leaves the rest of the query where it was', async () => {
      await arriveFederated('&redirectTo=%2Faccount%2Fsessions');

      expect(window.location.pathname).toBe('/mfa/challenge');
      expect(new URLSearchParams(window.location.search).get('redirectTo')).toBe('/account/sessions');
    });

    // The leak the address bar does not show: the router keeps the full path in
    // `history.state.current`, so a strip that only rewrites the URL leaves the
    // token in an entry readable by any same-origin script and persisted through
    // session restore. Observed in a real build before it was fixed.
    it('is removed from the history entry\'s own state, and the rest of that state is kept', async () => {
      const { token } = await arriveFederated('&redirectTo=%2Faccount%2Fsessions');

      const state = window.history.state as Record<string, unknown>;

      expect(JSON.stringify(state)).not.toContain(token);
      expect(state).toEqual({
        back: null,
        current: '/mfa/challenge?redirectTo=/account/sessions',
        forward: null,
        position: 1,
        replaced: true,
        scroll: false,
      });
    });

    it('leaves a state with no `current` exactly as it found it', async () => {
      const token = backend.mintChallenge(ACTOR_ID);
      visit(`/mfa/challenge?challengeToken=${token}`);
      window.history.replaceState({ position: 7 }, '');
      const replace = vi.spyOn(window.history, 'replaceState');

      await mountChallenge({ challengeToken: token });

      expect(replace.mock.calls[0]?.[0]).toEqual({ position: 7 });
    });

    it('loads nothing from another origin, so no request of its own can carry a Referer', async () => {
      const { wrapper } = await arriveFederated();

      // The policy itself is a response header, pinned in `test/nuxt-config.spec.ts`.
      // Nothing this page renders points anywhere but here: no absolute URL in an
      // attribute, so nothing whose request could carry a `Referer`.
      expect(wrapper.html()).not.toMatch(/(?:src|href|action|srcset|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    });

    it('is not written into the page, a cookie or storage', async () => {
      const cookies: string[] = [];
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '',
        set: (value: string) => {
          cookies.push(value);
        },
      });
      const written: string[] = [];
      const recording = (): Storage => ({
        length: 0,
        clear: () => undefined,
        getItem: () => null,
        key: () => null,
        removeItem: () => undefined,
        setItem: (key: string, value: string) => {
          written.push(`${key}=${value}`);
        },
      });
      vi.stubGlobal('localStorage', recording());
      vi.stubGlobal('sessionStorage', recording());

      const { token, wrapper } = await arriveFederated();
      try {
        expect(wrapper.html()).not.toContain(token);
        expect(cookies).toEqual([]);
        expect(written).toEqual([]);
        const state = (getActivePinia() as Pinia).state.value.auth as Record<string, unknown>;
        expect(JSON.stringify(state)).not.toContain(token);
      } finally {
        Reflect.deleteProperty(document, 'cookie');
      }
    });

    it('strips a parameter it did not take as well: a repeated key never stays in the bar', async () => {
      visit('/mfa/challenge?challengeToken=one&challengeToken=two');

      await mountChallenge({ challengeToken: ['one', 'two'] });

      expect(window.location.search).toBe('');
    });

    // The redirect carries a token and no list; the page asks for the list the
    // password door receives inline. Without it, a code has no id to travel with
    // and every federated sign-in would cost a recovery code.
    it('asks which methods the token may be finished with, and offers a code', async () => {
      const { wrapper } = await arriveFederated();

      expect(useAuthStore().challenge?.methods).toHaveLength(2);
      expect(wrapper.find('#mfa-code').exists()).toBe(true);
      expect(backend.liveChallenges()).toBe(1);
    });

    it('finishes a federated sign-in with an authenticator code and no recovery code', async () => {
      const { token, wrapper } = await arriveFederated('&redirectTo=%2Faccount%2Fsessions');

      await wrapper.find('#mfa-code').setValue(AUTHENTICATOR_ANSWER);
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(backend.mfaVerifyBodies()).toEqual([{
        challengeToken: token,
        methodId: AUTHENTICATOR_ID,
        code: AUTHENTICATOR_ANSWER,
      }]);
      expect(useAuthStore().isAuthenticated).toBe(true);
      expect(navigations).toEqual(['/account/sessions']);
    });

    it('goes to sign in when the token turns out not to be presentable', async () => {
      visit(`/mfa/challenge?challengeToken=${UNKNOWN_CHALLENGE}`);

      const wrapper = await mountChallenge({ challengeToken: UNKNOWN_CHALLENGE });

      expect(navigations).toEqual(['/login']);
      expect(wrapper.find('form').exists()).toBe(false);
      expect(window.location.search).toBe('');
    });

    it('still offers a recovery code when the list could not be fetched', async () => {
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));
      const token = backend.mintChallenge(ACTOR_ID);
      visit(`/mfa/challenge?challengeToken=${token}`);

      const wrapper = await mountChallenge({ challengeToken: token });

      expect(navigations).toEqual([]);
      expect(wrapper.find('#mfa-recovery-code').exists()).toBe(true);
      expect(wrapper.find('#mfa-code').exists()).toBe(false);
    });
  });

  describe('arriving with nothing to finish', () => {
    it('sends the person to sign in rather than showing a form that cannot work', async () => {
      const wrapper = await mountChallenge();

      expect(navigations).toEqual(['/login']);
      expect(wrapper.find('form').exists()).toBe(false);
    });

    it('keeps where they were going', async () => {
      await mountChallenge({ redirectTo: '/account/sessions' });

      expect(navigations).toEqual(['/login?redirect=%2Faccount%2Fsessions']);
    });

    it('does NOT keep a destination that is not in this application', async () => {
      await mountChallenge({ redirectTo: '//elsewhere.example/x' });

      expect(navigations).toEqual(['/login']);
    });
  });

  describe('finishing', () => {
    async function throughLogin(
      query: Record<string, unknown> = {},
    ): Promise<ReturnType<typeof mount>> {
      await signInThroughTheLoginPage();
      navigations.length = 0;
      return mountChallenge(query);
    }

    it('sends the challenge token and the code to /auth/mfa/verify, then goes where it was headed', async () => {
      const wrapper = await throughLogin({ redirectTo: '/account/sessions' });

      // Two authenticators would show a picker; one does not.
      expect(wrapper.find('#mfa-method').exists()).toBe(false);
      await wrapper.find('#mfa-code').setValue(` ${AUTHENTICATOR_ANSWER} `);
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(backend.mfaVerifyBodies()).toEqual([{
        challengeToken: tokens[0],
        methodId: AUTHENTICATOR_ID,
        code: AUTHENTICATOR_ANSWER,
      }]);
      expect(useAuthStore().isAuthenticated).toBe(true);
      expect(navigations).toEqual(['/account/sessions']);
    });

    it('goes home when nothing named a place, and NOT where a protocol-relative link asked', async () => {
      const wrapper = await throughLogin({ redirectTo: '//elsewhere.example/x' });

      await wrapper.find('#mfa-code').setValue(AUTHENTICATOR_ANSWER);
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(navigations).toEqual(['/']);
    });

    it('sends a recovery code alone, when that is the way chosen', async () => {
      const wrapper = await throughLogin();

      const toggle = wrapper.findAll('button').find((one) => one.text() === 'auth.mfa.actions.useRecoveryCode');
      await toggle?.trigger('click');
      await wrapper.find('#mfa-recovery-code').setValue(RECOVERY_ANSWER);
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const [sent] = backend.mfaVerifyBodies();
      expect(Object.keys(sent ?? {}).sort()).toEqual(['challengeToken', 'recoveryCode']);
      expect(useAuthStore().isAuthenticated).toBe(true);
    });

    it('signs in with a passkey when the browser has one to offer', async () => {
      const wrapper = await throughLogin();

      await wrapper.find('#mfa-passkey').trigger('click');
      await flushPromises();

      expect(useAuthStore().isAuthenticated).toBe(true);
      expect(navigations).toEqual(['/']);
    });

    it('does NOT offer a passkey in a browser that cannot answer one', async () => {
      browser.supported = false;

      const wrapper = await throughLogin();

      expect(wrapper.find('#mfa-passkey').exists()).toBe(false);
    });

    it('does NOT offer a passkey to an account that holds none', async () => {
      backend.requireSecondFactor(ACTOR_ID, {
        methods: [{ id: AUTHENTICATOR_ID, type: 'TOTP', label: 'Phone', code: AUTHENTICATOR_ANSWER }],
      });

      const wrapper = await throughLogin();

      expect(wrapper.find('#mfa-passkey').exists()).toBe(false);
    });
  });

  describe('failing', () => {
    async function throughLogin(): Promise<ReturnType<typeof mount>> {
      await signInThroughTheLoginPage();
      navigations.length = 0;
      return mountChallenge();
    }

    async function submitCode(wrapper: ReturnType<typeof mount>, code: string): Promise<void> {
      await wrapper.find('#mfa-code').setValue(code);
      await wrapper.find('form').trigger('submit');
      await flushPromises();
    }

    // The client half of the enumeration property. Each of these is a different
    // thing going wrong, and one of them is not a refusal at all but a browser
    // that would not sign. A screen that told any two apart would fail here.
    it('does NOT say anything different for a different failure', async () => {
      const shown: string[] = [];
      const said = (one: ReturnType<typeof mount>): string => one.text().replace(/\s+/g, ' ');

      // A wrong code.
      let wrapper = await throughLogin();
      await submitCode(wrapper, WRONG_ANSWER);
      shown.push(said(wrapper));

      // A challenge that was spent somewhere else — another tab, a replay — so
      // that the code offered is the right one and the token is what is wrong.
      wrapper = await throughLogin();
      await backend.client({
        method: 'POST',
        path: '/auth/mfa/verify',
        body: { challengeToken: tokens[tokens.length - 1], recoveryCode: RECOVERY_ANSWER },
      });
      await submitCode(wrapper, AUTHENTICATOR_ANSWER);
      shown.push(said(wrapper));

      // A transport that is not there at all: no refusal, no answer of any kind.
      wrapper = await throughLogin();
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));
      await submitCode(wrapper, AUTHENTICATOR_ANSWER);
      shown.push(said(wrapper));

      expect(shown).toHaveLength(3);
      expect(shown[0]).toContain('auth.mfa.failed');
      expect(new Set(shown).size).toBe(1);
    });

    it('stops offering inputs once the challenge is spent, and offers the way back', async () => {
      const wrapper = await throughLogin();

      await submitCode(wrapper, WRONG_ANSWER);

      expect(wrapper.find('#mfa-code').exists()).toBe(false);
      expect(wrapper.find('form').exists()).toBe(false);
      expect(wrapper.find('a[href="/login"]').exists()).toBe(true);
      expect(navigations).toEqual([]);
      expect(useAuthStore().isAuthenticated).toBe(false);
    });

    it('does NOT navigate anywhere on a refusal', async () => {
      const wrapper = await throughLogin();

      await submitCode(wrapper, WRONG_ANSWER);

      expect(navigations).toEqual([]);
    });

    it('keeps the form when the person dismissed the passkey prompt, because nothing was spent', async () => {
      browser.refuse = true;
      const wrapper = await throughLogin();

      await wrapper.find('#mfa-passkey').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('auth.mfa.failed');
      // The options leg spent the first token and minted the next; the person
      // can still answer with the other way.
      expect(useAuthStore().challenge).not.toBeNull();
      expect(wrapper.find('#mfa-code').exists()).toBe(true);
      expect(useAuthStore().isAuthenticated).toBe(false);
    });
  });
});
