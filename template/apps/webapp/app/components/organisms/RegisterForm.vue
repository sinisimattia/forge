<script setup lang="ts">
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';
import { DisplayNameRequiredError } from '__FORGE_SCOPE__/core/users/errors';
import { normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';

/**
 * Bringing an account into being.
 *
 * ## Success here is not "the account was created"
 *
 * `IAuthService.register` resolves whether or not the address is already in use,
 * deliberately: an answer that differed would be the same enumeration oracle
 * sign-in is careful to avoid, and registration is the easiest of the three
 * endpoints to probe. So there is **no** "that address is already registered"
 * state to render, and adding one would need the backend to start telling this
 * side something it currently refuses to. What resolving means is "if that
 * address had no account, one now exists and a message is on its way"; the page
 * says exactly that and nothing about which of the two happened.
 *
 * ## The one refusal it does render
 *
 * `WeakPasswordError`, with every violation it carries rather than the first —
 * that is why the error carries a list. The policy is a published rule of the
 * deployment, so refusing a secret that breaks it reveals nothing about any
 * address, which is why this refusal is allowed to be specific where the rest
 * are not.
 */
const emit = defineEmits<{
  /** Registration was accepted. The page renders what happens next. */
  registered: [];
}>();

const { register } = useRegistration();
const { t } = useI18n();

const displayNameInput = ref('');
const emailInput = ref('');
const secretInput = ref('');
const pending = ref(false);
const failed = ref(false);
const nameError = ref('');
const reportedViolations = ref<readonly PasswordPolicyViolation[]>([]);

async function submit(): Promise<void> {
  pending.value = true;
  failed.value = false;
  nameError.value = '';
  reportedViolations.value = [];
  try {
    await register(
      normalizeEmail(emailInput.value),
      displayNameInput.value,
      secretInput.value,
    );
    emit('registered');
  } catch (error) {
    if (error instanceof WeakPasswordError) reportedViolations.value = error.violations;
    else if (error instanceof DisplayNameRequiredError) nameError.value = t('auth.register.nameRequired');
    // Everything else is one message. There is nothing specific this side may
    // say about a refusal the server declined to characterise.
    else failed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppStack as="form" gap="md" @submit.prevent="submit">
    <AppAlert v-if="failed" variant="error">{{ t('auth.register.failed') }}</AppAlert>
    <FormField id="register-name" :label="t('auth.fields.displayName')" :error="nameError">
      <AppInput
        id="register-name"
        v-model="displayNameInput"
        type="text"
        :disabled="pending"
        :has-error="nameError !== ''"
        autocomplete="name"
      />
    </FormField>
    <FormField id="register-email" :label="t('auth.fields.email')">
      <AppInput
        id="register-email"
        v-model="emailInput"
        type="email"
        :disabled="pending"
        autocomplete="email"
      />
    </FormField>
    <PasswordField
      id="register-secret"
      v-model="secretInput"
      :label="t('auth.fields.newPassword')"
      :disabled="pending"
      :reported-violations="reportedViolations"
      autocomplete="new-password"
      check-policy
    />
    <AppButton type="submit" :loading="pending">{{ t('auth.actions.register') }}</AppButton>
  </AppStack>
</template>
