<script setup lang="ts">
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { authorizationPathFor } from '~/services';
import { localRedirect, SIGNED_IN_HOME } from '~/utils/redirect';

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

useHead({ title: t('auth.signIn.title') });
onMounted(load);

async function onAuthenticated(): Promise<void> {
  await navigateTo(localRedirect(route.query.redirect, SIGNED_IN_HOME));
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
  const target = localRedirect(route.query.redirect, SIGNED_IN_HOME);
  window.location.href = `${config.public.apiBase}${authorizationPathFor(provider, target)}`;
}
</script>

<template>
  <AppStack gap="lg">
    <LoginForm @authenticated="onAuthenticated" />
    <OAuthButtons :providers="providers" @choose="beginFederatedSignIn" />
    <AppStack direction="row" justify="between" gap="md">
      <AppLink to="/forgot-password">{{ t('auth.signIn.forgotPassword') }}</AppLink>
      <AppLink to="/register">{{ t('auth.signIn.noAccount') }}</AppLink>
    </AppStack>
  </AppStack>
</template>
