<script setup lang="ts">
import { InvalidCredentialsError } from '__FORGE_SCOPE__/core/auth/errors';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';

/**
 * Changing the secret the person holds.
 *
 * ## It goes through the store, not through a service
 *
 * The backend ends every session the user holds and opens a fresh one for the
 * request it is serving, so the answer carries a new access credential — exactly
 * as a sign-in does. `useAuth().changePassword` takes it up. A page that called
 * `AuthHttpService.changePassword` itself would leave the application presenting
 * a credential the server had just killed, and the symptom would be "changing my
 * password signs me out", arriving one request later.
 *
 * The other sessions really are gone, and the page says so: somebody who is
 * signed in on a phone will be asked for the new secret there, which is the whole
 * point of ending them and is alarming if unannounced.
 */
definePageMeta({
  layout: 'account',
  middleware: 'auth',
});

const { changePassword } = useAuth();
const { t } = useI18n();

useHead({ title: t('account.security.title') });

const currentSecretInput = ref('');
const newSecretInput = ref('');
const pending = ref(false);
const changed = ref(false);
const wrongCurrent = ref(false);
const failed = ref(false);
const reportedViolations = ref<readonly PasswordPolicyViolation[]>([]);

async function submit(): Promise<void> {
  pending.value = true;
  changed.value = false;
  wrongCurrent.value = false;
  failed.value = false;
  reportedViolations.value = [];
  try {
    await changePassword(currentSecretInput.value, newSecretInput.value);
    changed.value = true;
    currentSecretInput.value = '';
    newSecretInput.value = '';
  } catch (error) {
    // Naming this one is not an enumeration risk: whoever is here has already
    // proved they hold the account, so "that is not your current password" tells
    // them something only they can act on and tells a stranger nothing.
    if (error instanceof InvalidCredentialsError) wrongCurrent.value = true;
    else if (error instanceof WeakPasswordError) reportedViolations.value = error.violations;
    else failed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppCard variant="elevated">
    <AppStack gap="lg">
      <AppHeading as="h1" size="lg">{{ t('account.security.title') }}</AppHeading>
      <AppAlert v-if="changed" variant="success">{{ t('account.security.changed') }}</AppAlert>
      <AppAlert v-if="wrongCurrent" variant="error">
        {{ t('account.security.wrongCurrent') }}
      </AppAlert>
      <AppAlert v-if="failed" variant="error">{{ t('account.security.failed') }}</AppAlert>
      <AppAlert variant="info">{{ t('account.security.endsOtherSessions') }}</AppAlert>
      <AppStack as="form" gap="md" @submit.prevent="submit">
        <PasswordField
          id="security-current"
          v-model="currentSecretInput"
          :label="t('auth.fields.currentPassword')"
          :disabled="pending"
          autocomplete="current-password"
        />
        <PasswordField
          id="security-new"
          v-model="newSecretInput"
          :label="t('auth.fields.newPassword')"
          :disabled="pending"
          :reported-violations="reportedViolations"
          autocomplete="new-password"
          check-policy
        />
        <AppButton type="submit" :loading="pending">
          {{ t('auth.actions.setPassword') }}
        </AppButton>
      </AppStack>
    </AppStack>
  </AppCard>
</template>
