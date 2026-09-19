<script setup lang="ts">
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
 */
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
  authTitleKey: 'auth.signIn.title',
  authSubtitleKey: 'auth.signIn.subtitle',
});

const { t } = useI18n();
const route = useRoute();

useHead({ title: t('auth.signIn.title') });

async function onAuthenticated(): Promise<void> {
  await navigateTo(localRedirect(route.query.redirect, SIGNED_IN_HOME));
}
</script>

<template>
  <AppStack gap="lg">
    <LoginForm @authenticated="onAuthenticated" />
    <AppStack direction="row" justify="between" gap="md">
      <AppLink to="/forgot-password">{{ t('auth.signIn.forgotPassword') }}</AppLink>
      <AppLink to="/register">{{ t('auth.signIn.noAccount') }}</AppLink>
    </AppStack>
  </AppStack>
</template>
