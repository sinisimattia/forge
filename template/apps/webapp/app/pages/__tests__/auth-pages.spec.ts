import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import { mountOptions, navigations, route, stubAutoImports } from '~/components/__tests__/harness';
import { ApiError } from '~/fetchers';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { useAuthStore } from '~/stores/auth';
import { FEDERATED_REFUSAL_CODES } from '~/types';
import type { ApiClient, ApiErrorCode, ApiRequest } from '~/types';
import ForgotPasswordPage from '../forgot-password.vue';
import LoginPage from '../login.vue';
import OAuthCallbackPage from '../oauth/callback.vue';
import ResetPasswordPage from '../reset-password.vue';
import VerifyEmailPage from '../verify-email.vue';

/**
 * The four pages a signed-out visitor meets, driven as pages.
 *
 * They were shipped untested, and each of the four holds a **decision** — not
 * wiring, a decision, with an argument written beside it in the file. An argument
 * with no assertion behind it is a claim about nothing: every one of the branches
 * below can be collapsed into a single `failed` and the rest of the suite stays
 * green. That is what these exist to stop.
 */

/** A password that satisfies `DEFAULT_PASSWORD_POLICY`. Not a credential anywhere. */
const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';
const ACTOR_ID = 'stub-User-1' as UserId;

/** `example.test` is reserved by RFC 6761 and resolves for nobody. */
const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  // Verified, so the sign-in tests below can actually sign in. The
  // verify-email tests do not need an unverified account: the endpoint spends
  // the link and marks the address proven whatever state it was in.
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

/** Something the world will never answer to. Its shape is irrelevant; it is not real. */
const LINK_VALUE = 'stub-verification-fixture';

/**
 * What a forged or stale `token`/`accessToken` query parameter looks like: real
 * shapes, naming nothing the world holds. Named bindings rather than literals at
 * their use site, for the reason the seam spec gives — the extraction gate
 * strips interpolations from a template literal before judging the remainder,
 * and a short quoted remainder under a secret-shaped key reads as a populated
 * credential.
 */
const FORGED_CREDENTIAL = 'not-a-real-credential';
const FORGED_ACCESS_CREDENTIAL = 'also-not-a-real-credential';

describe('the pages a signed-out visitor meets', () => {
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

  /**
   * The world, except that one path answers with a refusal of my choosing.
   *
   * Everything else still goes to the stub, so the fetcher and the service — and
   * therefore the mapping from an envelope `code` to the core error the page
   * branches on — are the shipped ones. Only the answer is arranged.
   */
  function refusing(path: string, status: number, code: ApiErrorCode): ApiClient {
    return <T>(request: ApiRequest): Promise<T> => (
      request.path === path
        ? Promise.reject(new ApiError(status, { error: 'Gone', message: 'no', code }))
        : backend.client<T>(request)
    );
  }

  describe('verify-email', () => {
    it('confirms the address when the link is good', async () => {
      backend.putVerification(ACTOR_ID, LINK_VALUE, new Date(Date.now() + 60_000));
      route.query = { token: LINK_VALUE };

      const wrapper = mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();

      expect(wrapper.text()).toContain('auth.verifyEmail.verified');
    });

    it('says the link has already been used when it has', async () => {
      backend.putVerification(ACTOR_ID, LINK_VALUE, new Date(Date.now() + 60_000));
      route.query = { token: LINK_VALUE };
      // Spent by a first visit, through the same page: the second visit is what a
      // person following a link twice actually does.
      mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();

      const second = mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();

      expect(second.text()).toContain('auth.verifyEmail.alreadyUsed');
    });

    it('does NOT say the same thing when the link has expired', async () => {
      // **The assertion this file was asked for.** `verify-email.vue` argues at
      // length that collapsing these two is wrong — an already-used link usually
      // means the address is verified and the person can just sign in, an expired
      // one means they need a fresh message — and nothing tested it. Replacing
      // both arms with one `failed` ships green without this.
      backend.putVerification(ACTOR_ID, LINK_VALUE, new Date(Date.now() - 60_000));
      route.query = { token: LINK_VALUE };

      const wrapper = mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();

      expect(wrapper.text()).toContain('auth.verifyEmail.expired');
      expect(wrapper.text()).not.toContain('auth.verifyEmail.alreadyUsed');
      expect(wrapper.text()).not.toContain('auth.verifyEmail.verified');
    });

    it('does NOT claim either when it simply could not ask', async () => {
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));
      route.query = { token: LINK_VALUE };

      const wrapper = mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();

      expect(wrapper.text()).toContain('auth.verifyEmail.failed');
      expect(wrapper.text()).not.toContain('auth.verifyEmail.expired');
      expect(wrapper.text()).not.toContain('auth.verifyEmail.alreadyUsed');
    });

    it('spends the link exactly once, and does NOT spend it when there is none', async () => {
      // The single-use hazard the page's own comment names: verifying during the
      // render as well as after it would spend the value on the server and then
      // report "already used" to somebody following the link for the first time.
      // Counting the requests is the only way to see that from here.
      const seen: string[] = [];
      backend.putVerification(ACTOR_ID, LINK_VALUE, new Date(Date.now() + 60_000));
      useAuthStore().adoptTransport(<T>(request: ApiRequest): Promise<T> => {
        seen.push(request.path);
        return backend.client<T>(request);
      });

      route.query = {};
      mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();
      expect(seen).toEqual([]);

      route.query = { token: LINK_VALUE };
      mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();
      expect(seen).toEqual(['/auth/verify-email']);
    });

    it('offers to send another, and says the same thing however that goes', async () => {
      // `resendVerification` resolves whether or not the address is known. A page
      // that showed an error for some addresses and a success for others would be
      // the enumeration oracle the endpoint is written to avoid — so even a
      // transport failure gets the one answer.
      route.query = {};
      const wrapper = mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();

      await wrapper.find('#resend-email').setValue(ACTOR.email);
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      const known = wrapper.text();

      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));
      const broken = mount(VerifyEmailPage, { global: mountOptions() });
      await flushPromises();
      await broken.find('#resend-email').setValue('nobody@example.test');
      await broken.find('form').trigger('submit');
      await flushPromises();

      expect(known).toContain('auth.verifyEmail.resent');
      expect(broken.text()).toContain('auth.verifyEmail.resent');
    });
  });

  describe('reset-password', () => {
    it('says every session has ended, before the person commits to it', async () => {
      // Recovery ends every session the account holds, including one open on
      // another device. Saying so only afterwards makes a correct mass sign-out
      // read as a fault on whatever device is still open.
      route.query = { token: LINK_VALUE };
      const wrapper = mount(ResetPasswordPage, { global: mountOptions() });
      expect(wrapper.text()).toContain('auth.resetPassword.endsEverySession');
    });

    it('tells a used link and an expired one apart', async () => {
      route.query = { token: LINK_VALUE };

      useAuthStore().adoptTransport(refusing('/auth/reset-password', 410, 'TOKEN_CONSUMED'));
      const used = mount(ResetPasswordPage, { global: mountOptions() });
      await used.find('#reset-secret').setValue(PLAINTEXT);
      await used.find('form').trigger('submit');
      await flushPromises();

      useAuthStore().adoptTransport(refusing('/auth/reset-password', 410, 'TOKEN_EXPIRED'));
      const stale = mount(ResetPasswordPage, { global: mountOptions() });
      await stale.find('#reset-secret').setValue(PLAINTEXT);
      await stale.find('form').trigger('submit');
      await flushPromises();

      expect(used.text()).toContain('auth.resetPassword.alreadyUsed');
      expect(used.text()).not.toContain('auth.resetPassword.expired');
      expect(stale.text()).toContain('auth.resetPassword.expired');
      expect(stale.text()).not.toContain('auth.resetPassword.alreadyUsed');
    });

    it('shows what was wrong with the secret rather than a generic refusal', async () => {
      route.query = { token: LINK_VALUE };
      const wrapper = mount(ResetPasswordPage, { global: mountOptions() });

      await wrapper.find('#reset-secret').setValue('short');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.text()).toContain('auth.passwordRules.tooShort');
      expect(wrapper.text()).not.toContain('auth.resetPassword.failed');
    });

    it('does NOT offer the form at all when the link carried nothing', () => {
      route.query = {};
      const wrapper = mount(ResetPasswordPage, { global: mountOptions() });
      expect(wrapper.text()).toContain('auth.resetPassword.noLink');
      expect(wrapper.find('#reset-secret').exists()).toBe(false);
    });
  });

  describe('forgot-password', () => {
    it('answers the same way for a known address and an unknown one', async () => {
      const answers: string[] = [];
      for (const address of [ACTOR.email, 'nobody@example.test']) {
        const wrapper = mount(ForgotPasswordPage, { global: mountOptions() });
        await wrapper.find('#forgot-email').setValue(address);
        await wrapper.find('form').trigger('submit');
        await flushPromises();
        answers.push(wrapper.html());
      }
      expect(answers[0]).toContain('auth.forgotPassword.asked');
      expect(new Set(answers).size).toBe(1);
    });

    it('does NOT answer differently when the request itself failed', async () => {
      // An error rendered for some addresses and not others is the same
      // enumeration oracle spelled differently, so the failure is swallowed.
      useAuthStore().adoptTransport(() => Promise.reject(new Error('the backend is not there')));
      const wrapper = mount(ForgotPasswordPage, { global: mountOptions() });
      await wrapper.find('#forgot-email').setValue(ACTOR.email);
      await wrapper.find('form').trigger('submit');
      await flushPromises();
      expect(wrapper.text()).toContain('auth.forgotPassword.asked');
    });

    it('does NOT claim to have sent anything before it is asked', () => {
      const wrapper = mount(ForgotPasswordPage, { global: mountOptions() });
      expect(wrapper.text()).not.toContain('auth.forgotPassword.asked');
    });
  });

  describe('login', () => {
    it('goes where the link asked, when the link asked for somewhere in this application', async () => {
      route.query = { redirect: '/account/sessions' };
      const wrapper = mount(LoginPage, { global: mountOptions() });

      await wrapper.find('#sign-in-email').setValue(ACTOR.email);
      await wrapper.find('#sign-in-secret').setValue(PLAINTEXT);
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(navigations).toEqual(['/account/sessions']);
    });

    it('does NOT go where a protocol-relative link asked', async () => {
      // `//elsewhere.example/x` begins with a slash, so it survives a check
      // written as "must start with a slash", and a browser reads it as an
      // absolute URL to another origin. A sign-in page is the most valuable place
      // in an application to have an open redirect: the link is to the real site,
      // on the real domain, and the person is expecting to type a password.
      route.query = { redirect: '//elsewhere.example/x' };
      const wrapper = mount(LoginPage, { global: mountOptions() });

      await wrapper.find('#sign-in-email').setValue(ACTOR.email);
      await wrapper.find('#sign-in-secret').setValue(PLAINTEXT);
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(navigations).toEqual(['/']);
    });

    it('does NOT navigate at all when the sign-in was refused', async () => {
      const wrapper = mount(LoginPage, { global: mountOptions() });

      await wrapper.find('#sign-in-email').setValue(ACTOR.email);
      await wrapper.find('#sign-in-secret').setValue(`${PLAINTEXT}-not`);
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(navigations).toEqual([]);
    });
  });

  describe('oauth/callback', () => {
    /**
     * Leaves a real, valid renewal cookie sitting in `backend`'s own world — the
     * same thing `OAuthController.callback` leaves behind before it redirects
     * here — without leaving the *store under test* already signed in.
     *
     * A throwaway store does the signing in and is then discarded; a fresh
     * `Pinia` (and therefore a fresh `useAuthStore()`) is what the page under
     * test actually sees. That split is not test plumbing invented for this
     * file — it is production's own shape: the cookie in the world and the
     * store that has never asked about it are exactly what a browser holds the
     * instant it lands on this page, `accessToken` having never been part of
     * anything that travelled (see `stores/auth.ts` → `heldCredential`). Reusing
     * the *same* store for both halves would leave it already `authenticated`
     * before the page ever mounted, and every assertion below would pass for a
     * page that renews nothing at all.
     */
    async function presentAValidRenewalCookie(): Promise<void> {
      const bootstrap = useAuthStore();
      bootstrap.adoptTransport(backend.client);
      await bootstrap.login(ACTOR.email, PLAINTEXT);

      setActivePinia(createPinia());
      useAuthStore().adoptTransport(backend.client);
    }

    it('renews through the store — not a URL credential — then goes where redirectTo said', async () => {
      await presentAValidRenewalCookie();
      route.query = { redirectTo: '/account/sessions' };

      mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(navigations).toEqual(['/account/sessions']);
      expect(useAuthStore().isAuthenticated).toBe(true);
    });

    it('goes to / when nothing named a place to go back to', async () => {
      await presentAValidRenewalCookie();
      route.query = {};

      mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(navigations).toEqual(['/']);
    });

    it('does NOT go where a protocol-relative redirectTo asked', async () => {
      // The same open-redirect shape `login.vue`'s own `redirect` is guarded
      // against, on the query name this page reads instead.
      await presentAValidRenewalCookie();
      route.query = { redirectTo: '//elsewhere.example/x' };

      mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(navigations).toEqual(['/']);
    });

    it('ignores a token in the query string, and does NOT sign in from it alone', async () => {
      // No cookie was ever presented to this world — nothing seeded it, unlike
      // every test above. This is what a forged or stale link looks like: real
      // shaped values, naming nothing real. A page that read `token` or
      // `accessToken` off the query string and trusted it would sign in here
      // regardless of the world; this is the assertion that it does not.
      route.query = {
        token: FORGED_CREDENTIAL,
        accessToken: FORGED_ACCESS_CREDENTIAL,
        redirectTo: '/account/sessions',
      };

      const wrapper = mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(navigations).toEqual([]);
      expect(useAuthStore().isAuthenticated).toBe(false);
      expect(useAuthStore().accessToken).toBeNull();
      expect(wrapper.text()).toContain('auth.oauthCallback.failed');
    });

    it('does NOT attempt a renewal at all once the backend already refused', async () => {
      const seen: string[] = [];
      useAuthStore().adoptTransport(<T>(request: ApiRequest): Promise<T> => {
        seen.push(request.path);
        return backend.client<T>(request);
      });
      route.query = { error: 'PROVIDER_UNAVAILABLE' };

      mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(seen).toEqual([]);
      expect(navigations).toEqual([]);
    });

    it('carries the remedy for an address that already belongs to an account — the human half of D11', async () => {
      route.query = { error: 'EMAIL_ALREADY_REGISTERED' };

      const wrapper = mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(navigations).toEqual([]);
      expect(wrapper.text()).toContain('auth.oauthCallback.errors.EMAIL_ALREADY_REGISTERED');
    });

    it('gives every one of the seven refusal codes its own message', async () => {
      const seen = new Map<string, string>();
      for (const code of FEDERATED_REFUSAL_CODES) {
        route.query = { error: code };
        const wrapper = mount(OAuthCallbackPage, { global: mountOptions() });
        await flushPromises();
        seen.set(code, wrapper.text());
      }

      expect(seen.size).toBe(FEDERATED_REFUSAL_CODES.length);
      // Distinct precisely because each names its own translation key — a
      // shared fallback for two of the seven would collapse this to fewer
      // than seven distinct strings.
      expect(new Set(seen.values()).size).toBe(FEDERATED_REFUSAL_CODES.length);
    });

    it('falls back to a real message for a code it has never heard of — never the raw code, never blank', async () => {
      route.query = { error: 'SOMETHING_A_LATER_BACKEND_INVENTED' };

      const wrapper = mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(wrapper.text()).not.toContain('SOMETHING_A_LATER_BACKEND_INVENTED');
      expect(wrapper.text()).toContain('auth.oauthCallback.failed');
    });

    it('shows a generic failure, not a specific code, when the renewal itself simply fails', async () => {
      // No `error` on the query at all, and nothing seeded in the world to renew
      // — what a direct hit on this path, or a lapsed cookie, looks like.
      route.query = {};

      const wrapper = mount(OAuthCallbackPage, { global: mountOptions() });
      await flushPromises();

      expect(navigations).toEqual([]);
      expect(wrapper.text()).toContain('auth.oauthCallback.failed');
    });
  });
});
