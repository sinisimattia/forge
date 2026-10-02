<script setup lang="ts">
import { DisplayNameRequiredError } from '__FORGE_SCOPE__/core/users/errors';

/**
 * The person's own record: what there is of it, and the one field they own.
 *
 * The address is shown and not editable. Changing it means proving the new one,
 * which is re-verification — a different act with a different endpoint, and one
 * this application does not offer. Rendering it as a disabled input would suggest the
 * ability exists and is merely switched off, so it is rendered as text.
 */
definePageMeta({
  layout: 'account',
  middleware: 'auth',
});

const { save } = useProfile();
const currentUser = useCurrentUser();
const { t } = useI18n();

useHead({ title: t('account.profile.title') });

const displayNameInput = ref(currentUser.value?.displayName ?? '');
const pending = ref(false);
const saved = ref(false);
const nameError = ref('');
const failed = ref(false);

// The field starts from whoever is signed in, and that is not known on the first
// render of a full page load: `status` is `unknown` until the renewal answers, so
// `currentUser` is null and the initial value above is `''`. Without this the
// form would open blank for every visitor who arrived by refreshing the page.
watch(currentUser, (person) => {
  if (person !== null && displayNameInput.value === '') displayNameInput.value = person.displayName;
});

async function submit(): Promise<void> {
  pending.value = true;
  saved.value = false;
  nameError.value = '';
  failed.value = false;
  try {
    await save(displayNameInput.value);
    saved.value = true;
  } catch (error) {
    if (error instanceof DisplayNameRequiredError) nameError.value = t('account.profile.nameRequired');
    else failed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppCard variant="elevated">
    <AppStack gap="lg">
      <AppHeading as="h1" size="lg">{{ t('account.profile.title') }}</AppHeading>
      <AppStack gap="xs">
        <AppText color="muted" size="xs">{{ t('auth.fields.email') }}</AppText>
        <AppText color="default">{{ currentUser?.email }}</AppText>
      </AppStack>
      <AppAlert v-if="saved" variant="success">{{ t('account.profile.saved') }}</AppAlert>
      <AppAlert v-if="failed" variant="error">{{ t('account.profile.failed') }}</AppAlert>
      <AppStack as="form" gap="md" @submit.prevent="submit">
        <FormField id="profile-name" :label="t('auth.fields.displayName')" :error="nameError">
          <AppInput
            id="profile-name"
            v-model="displayNameInput"
            type="text"
            :disabled="pending"
            :has-error="nameError !== ''"
            autocomplete="name"
          />
        </FormField>
        <AppButton type="submit" :loading="pending">{{ t('common.actions.save') }}</AppButton>
      </AppStack>
    </AppStack>
  </AppCard>
</template>
