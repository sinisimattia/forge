<script setup lang="ts">
import { FEDERATED_REFUSAL_CODES } from '~/types';
import type { FederatedRefusalCode } from '~/types';
import { useAuthStore } from '~/stores/auth';
import { localRedirect, SIGNED_IN_HOME } from '~/utils/redirect';

/**
 * Where a federated provider's own redirect lands, after the backend has
 * already finished the sign-in.
 *
 * ## The success path is a renewal, not a token read
 *
 * `OAuthController.callback`'s own TSDoc is explicit about what it will never
 * do: put an access credential in this URL. R5 — a token in a query string
 * lands in browser history, the `Referer` header of whatever loads next, and
 * every proxy log on the way. What actually happens on success is that the
 * backend sets the refresh cookie exactly as `POST /auth/login` does, then
 * redirects here with nothing but a place to go next. So this page's only
 * honest way to become signed in is the one every other full page load
 * already uses: ask the store to renew, and let it exchange that cookie for a
 * credential of its own.
 *
 * **This is asserted, not merely believed.** A `token` or `accessToken` query
 * parameter is never read anywhere in this file — see
 * `pages/__tests__/auth-pages.spec.ts` → *oauth/callback* → "ignores a token
 * in the query string, and does not sign in from it alone", which lands the
 * page on exactly that query with no valid renewal cookie behind it and
 * asserts the outcome is a refusal, not a session. The point of that test is
 * not paranoia about today's code; it is to make a later "convenience" — read
 * `token` when it is there and skip the round trip — impossible to add
 * without turning a test red.
 *
 * ## Why this calls the store directly, bypassing `useAuth()`
 *
 * `useAuth()`'s own TSDoc draws the line on purpose: "a component has no
 * business calling `adoptTransport`, `renew` or `initialize`, which are the
 * application's own machinery." That line is right for an ordinary screen,
 * and wrong for this one — this page's entire job **is** that machinery,
 * the same way `middleware/auth.ts` reaches past `useAuth()` for the same
 * method for the same reason: establishing whether there is a session at all
 * is infrastructure, not a UI concern, and `useAuthStore()` is where
 * infrastructure is allowed to call it.
 *
 * `initialize()` rather than `renew()` directly, though the two end up
 * calling the same thing: under ordinary SSR, `auth-init.server.ts` already
 * renewed for this render and `auth-init.client.ts` already renewed again on
 * hydration — both complete, because Nuxt awaits every plugin before it
 * mounts a single page — so `status` is no longer `unknown` by the time this
 * component's `onMounted` runs, and `initialize()`'s own guard makes a second
 * renewal here a no-op. Only when nothing upstream has asked yet (no SSR, or
 * this component under test, where no plugin ever runs at all) does
 * `initialize()` do the one renewal this page exists to trigger — which is
 * the same renewal `auth-init.client.ts` performs, reached through the entry
 * point built for "ask once, whoever you are."
 *
 * ## The failure path names one of this repository's own seven codes
 *
 * `?error=<code>` is never a provider's own error text — `OAuthController`'s
 * own TSDoc says why: it is attacker-influenced, and this application would be
 * the one rendering it. `FEDERATED_REFUSAL_CODES` is this webapp's hand-typed
 * copy of the backend's `FederatedRefusalCode`; see its own TSDoc for what
 * keeps the two comparable. A code outside that list — one this file has not
 * been told about yet, or outright noise on the query string — gets the same
 * generic failure message as a renewal that simply did not succeed, rather
 * than the raw code rendered verbatim or a blank screen.
 *
 * `EMAIL_ALREADY_REGISTERED`'s own message is the one that needs a remedy in
 * it, not just a reason: it is the human half of D11, the refusal that stops a
 * provider-asserted address from taking over an account it does not already
 * control. Refusing with no way forward is a bug report waiting to be filed,
 * so that message says what to do — sign in the way already possible, then
 * link the provider from account settings — rather than only what went wrong.
 *
 * ## `redirectTo`, read from this page's own query — always, now
 *
 * Not `route.query.redirect`, the name `login.vue` reads. `OAuthController.landingUrl`
 * sends **every** completed authorization here — success and refusal alike —
 * carrying the authorization's own destination as `?redirectTo=` on *this*
 * page's own URL, never as the URL's own path. That backend method's own
 * TSDoc explains why every ending routes through here now: a first version
 * sent a successful authorization straight to its destination and appended
 * `?error=` only to a refusal's URL, which meant a refusal that had already
 * chosen a destination — `EMAIL_ALREADY_REGISTERED` among them — rendered on
 * whatever page it landed on, none of which read an `error` query parameter
 * at all. The remedy this file carries for that one code was minted and shown
 * to nobody.
 *
 * `redirectTo` is still attacker-reachable — it arrived on a query string a
 * link could set, same as `login.vue`'s own `redirect` — so it goes through
 * `localRedirect` a **second** time here before anything navigates to it,
 * even though `OAuthService.validateRedirectTo` already judged it once before
 * it was ever persisted on the authorization row this value came from. Two
 * independent checks on a value that crosses a redirect this application does
 * not compile against (ADR-0008): neither side gets a compiler-checked
 * guarantee that the other one's judgement survived the trip. A value that
 * does not pass becomes {@link SIGNED_IN_HOME} rather than an open redirect.
 */
definePageMeta({
  layout: 'auth',
  authTitleKey: 'auth.oauthCallback.title',
});

const { t } = useI18n();
const route = useRoute();
const store = useAuthStore();

useHead({ title: t('auth.oauthCallback.title') });

/** Where this page is: still asking, or told a refusal it must show. */
type Outcome = 'completing' | 'failed';

const outcome = ref<Outcome>('completing');

/** The one query parameter the failure path reads. Never `token`, never `accessToken`. */
const errorCode = computed(() => (
  typeof route.query.error === 'string' && route.query.error !== '' ? route.query.error : null
));

function isFederatedRefusalCode(value: string): value is FederatedRefusalCode {
  return (FEDERATED_REFUSAL_CODES as readonly string[]).includes(value);
}

/** The translated reason to show, once `outcome` is `failed`. */
const failureMessage = computed(() => {
  if (errorCode.value !== null && isFederatedRefusalCode(errorCode.value)) {
    return t(`auth.oauthCallback.errors.${errorCode.value}`);
  }
  // Every other case lands here on purpose: no code at all (a renewal that
  // simply did not succeed) and a code this file does not recognise both get
  // the one generic message, never the raw code and never a blank screen.
  return t('auth.oauthCallback.failed');
});

onMounted(async () => {
  if (errorCode.value !== null) {
    // The backend already decided this was a refusal; nothing here has a
    // credential to renew towards, and a renewal attempt would only add a
    // request that can only answer the question this query string already did.
    outcome.value = 'failed';
    return;
  }

  await store.initialize();

  if (store.isAuthenticated) {
    await navigateTo(localRedirect(route.query.redirectTo, SIGNED_IN_HOME));
    return;
  }

  outcome.value = 'failed';
});
</script>

<template>
  <AppStack gap="lg">
    <AppText v-if="outcome === 'completing'">{{ t('common.states.loading') }}</AppText>
    <AppAlert v-else variant="error">{{ failureMessage }}</AppAlert>
    <AppLink v-if="outcome === 'failed'" to="/login">{{ t('auth.actions.backToSignIn') }}</AppLink>
  </AppStack>
</template>
