<script setup lang="ts">
/**
 * Where somebody who cannot sign in asks for a way back.
 *
 * **One answer, whatever happens.** `IAuthService.requestPasswordReset` resolves
 * whether or not the address is known, and this page shows the same sentence in
 * both cases and after a transport failure as well. A page that said "no account
 * with that address" — or that showed an error for one address and a success for
 * another — would turn recovery into the address-enumeration oracle the endpoint
 * is written to avoid.
 */
definePageMeta({
  layout: 'auth',
  middleware: 'guest',
  authTitleKey: 'auth.forgotPassword.title',
  authSubtitleKey: 'auth.forgotPassword.subtitle',
});

const { request } = usePasswordRecovery();
const { t } = useI18n();

useHead({ title: t('auth.forgotPassword.title') });

const emailInput = ref('');
const pending = ref(false);
const asked = ref(false);

async function submit(): Promise<void> {
  pending.value = true;
  try {
    await request(emailInput.value);
  } catch {
    // Swallowed on purpose. See this page's own note: an error rendered for some
    // addresses and not others is the same oracle spelled differently.
  } finally {
    pending.value = false;
    asked.value = true;
  }
}
</script>

<template>
  <AppStack gap="lg">
    <AppAlert v-if="asked" variant="info">{{ t('auth.forgotPassword.asked') }}</AppAlert>
    <AppStack v-else as="form" gap="md" @submit.prevent="submit">
      <FormField id="forgot-email" :label="t('auth.fields.email')">
        <AppInput
          id="forgot-email"
          v-model="emailInput"
          type="email"
          :disabled="pending"
          autocomplete="email"
        />
      </FormField>
      <AppButton type="submit" :loading="pending">
        {{ t('auth.actions.sendResetLink') }}
      </AppButton>
    </AppStack>
    <AppLink to="/login">{{ t('auth.actions.backToSignIn') }}</AppLink>
  </AppStack>
</template>
