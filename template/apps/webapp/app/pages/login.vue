<script setup lang="ts">
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { authorizationPathFor } from '~/services';
import { localRedirect, MFA_CHALLENGE_PATH, SIGNED_IN_HOME } from '~/utils/redirect';

/**
 * Where somebody proves who they are.
 *
 * The form is `LoginForm`; what this page owns is the one thing the form must
 * not — where the person goes afterwards. `?redirect=` arrives from whoever
 * wrote the link, so it goes through `localRedirect` before anything navigates
 * to it. An unjudged one is an open redirect, and a sign-in page is the highest
 * value place in an application to have one: the link is to the real site, on
 * the real domain, and the person is expecting to be asked for a password.
 *
 * ## The federated buttons carry the same judged target
 *
 * `beginFederatedSignIn` resolves `?redirect=` through the very same
 * `localRedirect` call `onAuthenticated` uses, before handing it to
 * `authorizationPathFor`. A provider round-trip that skipped that judgement
 * would reopen the open redirect the rest of this page exists to close — the
 * link would still be to this application's own real domain, and the person
 * would still be expecting to land somewhere after proving who they are.
 */
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
  authTitleKey: 'auth.signIn.title',
  authSubtitleKey: 'auth.signIn.subtitle',
});

const { t } = useI18n();
const route = useRoute();
const config = useRuntimeConfig();
const { providers, load } = useOAuthProviders();
const redirecting = ref(false);

// A back-navigation from the provider's consent screen can restore this page from the
// browser's cache. The page is then shown, not re-run, so without this every provider
// button would stay disabled.
//
// Removed again on the way out: a single-page visit to this route mounts the page afresh, and
// a listener left behind would keep answering, with a ref nobody reads, for every visit before.
function onPageShow(shown: { persisted?: boolean }): void {
  if (shown.persisted) redirecting.value = false;
}
onMounted(() => window.addEventListener('pageshow', onPageShow));
onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow));

useHead({ title: t('auth.signIn.title') });
onMounted(load);

async function onAuthenticated(): Promise<void> {
  await navigateTo(localRedirect(route.query.redirect, SIGNED_IN_HOME));
}

/**
 * A correct password that is not enough. The challenge is in the store, in
 * memory; the destination the person was headed for travels as `redirectTo`, the
 * name the backend's own redirect to the same page gives it, and only when there
 * was somewhere to go — an absent parameter is how the page tells "nowhere" from
 * a destination.
 */
async function onChallenged(): Promise<void> {
  const destination = localRedirect(route.query.redirect, '');
  await navigateTo(
    destination === ''
      ? MFA_CHALLENGE_PATH
      : `${MFA_CHALLENGE_PATH}?redirectTo=${encodeURIComponent(destination)}`,
  );
}

/**
 * Leaves this application for the chosen provider's own consent screen.
 *
 * A real top-level navigation, never a `fetch` — `authorizationPathFor`'s own
 * TSDoc says why nothing here could issue one instead. The path it returns is
 * relative to the **backend's** origin, so it is resolved against
 * `runtimeConfig.public.apiBase` before anything navigates to it.
 */
function beginFederatedSignIn(provider: AuthProvider): void {
  // Disables every provider button until the browser has left: a second click
  // during the navigation would begin a second authorization the first one's
  // callback then cannot answer to.
  redirecting.value = true;
  const target = localRedirect(route.query.redirect, SIGNED_IN_HOME);
  window.location.href = `${config.public.apiBase}${authorizationPathFor(provider, target)}`;
}
</script>

<template>
  <AppStack gap="lg">
    <LoginForm @authenticated="onAuthenticated" @challenged="onChallenged" />
    <OAuthButtons :providers="providers" :busy="redirecting" @choose="beginFederatedSignIn" />
    <AppStack direction="row" justify="between" gap="md">
      <AppLink to="/forgot-password">{{ t('auth.signIn.forgotPassword') }}</AppLink>
      <AppLink to="/register">{{ t('auth.signIn.noAccount') }}</AppLink>
    </AppStack>
  </AppStack>
</template>
