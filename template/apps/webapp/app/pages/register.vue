<script setup lang="ts">
/**
 * Where an account comes into being.
 *
 * What is rendered on success says a message is on its way **if** that address
 * had no account, and nothing about which of the two happened. That wording is
 * load-bearing: `IAuthService.register` resolves either way on purpose, so a
 * page that said "account created" would be asserting something it was
 * deliberately not told — and, worse, a page that said "that address is already
 * registered" would republish the enumeration answer the endpoint exists to
 * withhold.
 */
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
  authTitleKey: 'auth.register.title',
  authSubtitleKey: 'auth.register.subtitle',
});

const { t } = useI18n();

useHead({ title: t('auth.register.title') });

const accepted = ref(false);
</script>

<template>
  <AppStack gap="lg">
    <AppAlert v-if="accepted" variant="success">{{ t('auth.register.accepted') }}</AppAlert>
    <RegisterForm v-else @registered="accepted = true" />
    <AppStack direction="row" justify="between" gap="md">
      <AppLink to="/login">{{ t('auth.register.haveAccount') }}</AppLink>
      <AppLink to="/verify-email">{{ t('auth.register.resendLink') }}</AppLink>
    </AppStack>
  </AppStack>
</template>
