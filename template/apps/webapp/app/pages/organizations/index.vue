<script setup lang="ts">
import {
  InvalidOrganizationSlugError,
  OrganizationNameRequiredError,
} from '__FORGE_SCOPE__/core/organizations/errors';

/**
 * Every organization the actor belongs to, and a way to start a new one.
 *
 * No `permission` middleware: `IOrganizationService.listOrganizations` and
 * `createOrganization` are two of the three routes `OrganizationHttpService`'s
 * own `domainErrorFor` names as sitting outside `PermissionsGuard` — creating
 * an organization needs no organization-scoped permission to already hold,
 * and listing the ones the actor belongs to answers only for that actor.
 * `auth` alone is the whole of what this screen needs to require.
 */
definePageMeta({
  layout: 'account',
  middleware: 'auth',
});

const { organizations, loading, failed, load, create } = useOrganization();
const { t } = useI18n();

useHead({ title: t('organizations.title') });

onMounted(load);

const nameInput = ref('');
const slugInput = ref('');
const pending = ref(false);
const created = ref(false);
const nameError = ref('');
const slugError = ref('');
const createFailed = ref(false);

async function submit(): Promise<void> {
  pending.value = true;
  created.value = false;
  nameError.value = '';
  slugError.value = '';
  createFailed.value = false;
  try {
    await create(nameInput.value, slugInput.value);
    created.value = true;
    nameInput.value = '';
    slugInput.value = '';
  } catch (error) {
    if (error instanceof OrganizationNameRequiredError) nameError.value = t('organizations.nameRequired');
    else if (error instanceof InvalidOrganizationSlugError) slugError.value = t('organizations.invalidSlug');
    else createFailed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppStack gap="lg">
    <AppCard variant="elevated">
      <AppStack gap="lg">
        <AppHeading as="h1" size="lg">{{ t('organizations.title') }}</AppHeading>
        <AppText color="muted">{{ t('organizations.subtitle') }}</AppText>
        <AppAlert v-if="failed" variant="error">{{ t('organizations.failed') }}</AppAlert>
        <AppText v-if="loading && organizations.length === 0">
          {{ t('common.states.loading') }}
        </AppText>
        <AppText v-else-if="organizations.length === 0">{{ t('organizations.empty') }}</AppText>
        <OrganizationSwitcher v-else :organizations="organizations" />
      </AppStack>
    </AppCard>
    <AppCard variant="elevated">
      <AppStack gap="lg">
        <AppHeading as="h2" size="sm">{{ t('organizations.create') }}</AppHeading>
        <AppAlert v-if="created" variant="success">{{ t('organizations.created') }}</AppAlert>
        <AppAlert v-if="createFailed" variant="error">{{ t('organizations.failed') }}</AppAlert>
        <AppStack as="form" gap="md" @submit.prevent="submit">
          <FormField
            id="organization-name"
            :label="t('organizations.fieldName')"
            :error="nameError"
          >
            <AppInput
              id="organization-name"
              v-model="nameInput"
              type="text"
              :disabled="pending"
              :has-error="nameError !== ''"
            />
          </FormField>
          <FormField
            id="organization-slug"
            :label="t('organizations.fieldSlug')"
            :error="slugError"
          >
            <AppInput
              id="organization-slug"
              v-model="slugInput"
              type="text"
              :disabled="pending"
              :has-error="slugError !== ''"
            />
          </FormField>
          <AppButton type="submit" :loading="pending">{{ t('organizations.create') }}</AppButton>
        </AppStack>
      </AppStack>
    </AppCard>
  </AppStack>
</template>
