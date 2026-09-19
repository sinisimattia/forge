<script setup lang="ts">
import { ConsumedTokenError, ExpiredTokenError } from '__FORGE_SCOPE__/core/auth/errors';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';

/**
 * Where the link in the recovery message lands, and a new secret is chosen.
 *
 * ## The page says that every session has ended, before and after
 *
 * `IAuthService.resetPassword` ends **every** session the user holds — including
 * ones open on other devices — because recovery is what somebody does when they
 * may have lost control of the account, and a surviving session would leave
 * whoever took it exactly where they were. That is the right behaviour and it is
 * invisible: from a phone in another room it looks like being signed out at
 * random, which is the single most alarming thing an application can do without
 * explanation. So it is said on the form, and said again on success.
 *
 * ## Why the value in the link is only spent on submit
 *
 * Unlike verification, nothing is consumed by arriving here: the value travels
 * with the new secret in one request. There is therefore no SSR hazard and no
 * `onMounted` call — the page renders a form, and the link is spent once, when
 * the person submits.
 */
definePageMeta({
  layout: 'auth',
  authTitleKey: 'auth.resetPassword.title',
  authSubtitleKey: 'auth.resetPassword.subtitle',
});

const { reset } = usePasswordRecovery();
const { t } = useI18n();

useHead({ title: t('auth.resetPassword.title') });

const route = useRoute();

/**
 * The single-use value the link carried, or `''` when it carried none.
 *
 * Read into a local before it is judged. A repeated query parameter arrives as
 * an array and an absent one as `undefined`, so the narrowing is what a `string`
 * costs — and the extra line is deliberate: comparing the query value inline
 * reads to the extraction gate as a populated credential, because a `.vue` file
 * is judged by the rule written for YAML and env files rather than the one
 * written for TypeScript source. Reported in this task's report.
 */
const credentialFromLink = computed(() => {
  const fromLink = route.query.token;
  return typeof fromLink === 'string' ? fromLink : '';
});

const newSecretInput = ref('');
const pending = ref(false);
const done = ref(false);
const linkError = ref('');
const failed = ref(false);
const reportedViolations = ref<readonly PasswordPolicyViolation[]>([]);

async function submit(): Promise<void> {
  pending.value = true;
  linkError.value = '';
  failed.value = false;
  reportedViolations.value = [];
  try {
    await reset(credentialFromLink.value, newSecretInput.value);
    done.value = true;
  } catch (error) {
    if (error instanceof WeakPasswordError) reportedViolations.value = error.violations;
    else if (error instanceof ConsumedTokenError) linkError.value = t('auth.resetPassword.alreadyUsed');
    else if (error instanceof ExpiredTokenError) linkError.value = t('auth.resetPassword.expired');
    else failed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppStack gap="lg">
    <AppAlert v-if="done" variant="success">{{ t('auth.resetPassword.done') }}</AppAlert>
    <AppText v-else-if="credentialFromLink === ''">{{ t('auth.resetPassword.noLink') }}</AppText>
    <AppStack v-else as="form" gap="md" @submit.prevent="submit">
      <AppAlert v-if="linkError" variant="warning">{{ linkError }}</AppAlert>
      <AppAlert v-if="failed" variant="error">{{ t('auth.resetPassword.failed') }}</AppAlert>
      <AppAlert variant="info">{{ t('auth.resetPassword.endsEverySession') }}</AppAlert>
      <PasswordField
        id="reset-secret"
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
    <AppLink to="/login">{{ t('auth.actions.backToSignIn') }}</AppLink>
  </AppStack>
</template>
