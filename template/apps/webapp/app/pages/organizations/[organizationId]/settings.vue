<script setup lang="ts">
import {
  InvalidOrganizationSlugError,
  OrganizationNameRequiredError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';

/**
 * One organization's own name, slug, resource grants, and the one way to end
 * it.
 *
 * `permission: 'organization:update'` is the coarsest thing every control on
 * this page needs at least a little of — `ROLE_PERMISSIONS` gives it to
 * OWNER and ADMIN together with every finer one this page reads
 * (`organization:delete`, `grant:read`, `grant:revoke`), so no page here
 * needs a permission scoped to anything but `organizationId`: every one of
 * them is an organization ROLE question, never a question about one grant's
 * own record. `organization:delete` is read again, separately, because
 * `ROLE_PERMISSIONS` gives it to OWNER alone — an ADMIN reaches this page
 * and never sees the control that would be refused.
 */
definePageMeta({
  layout: 'account',
  middleware: ['auth', 'permission'],
  permission: 'organization:update',
});

const route = useRoute();
const organizationId = route.params.organizationId as OrganizationId;

const {
  activeOrganization,
  load: loadOrganizations,
  setActive,
  update,
  remove,
} = useOrganization();
setActive(organizationId);

const {
  grants,
  loading: grantsLoading,
  failed: grantsFailed,
  load: loadGrants,
  revoke,
} = useGrants();
const canDelete = useCan('organization:delete', { organizationId });
const canRevokeGrant = useCan('grant:revoke', { organizationId });
const { t } = useI18n();

useHead({ title: t('organizations.settings.title') });

onMounted(() => {
  void loadOrganizations();
  void loadGrants();
});

const nameInput = ref('');
const slugInput = ref('');
const pending = ref(false);
const saved = ref(false);
const nameError = ref('');
const slugError = ref('');
const failed = ref(false);
const deleteOpen = ref(false);
const deleting = ref(false);

watch(activeOrganization, (organization) => {
  if (organization === null) return;
  if (nameInput.value === '') nameInput.value = organization.name;
  if (slugInput.value === '') slugInput.value = organization.slug;
}, { immediate: true });

async function submit(): Promise<void> {
  pending.value = true;
  saved.value = false;
  nameError.value = '';
  slugError.value = '';
  failed.value = false;
  try {
    await update(organizationId, { name: nameInput.value, slug: slugInput.value });
    saved.value = true;
  } catch (error) {
    if (error instanceof OrganizationNameRequiredError) nameError.value = t('organizations.nameRequired');
    else if (error instanceof InvalidOrganizationSlugError) slugError.value = t('organizations.invalidSlug');
    else failed.value = true;
  } finally {
    pending.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  deleting.value = true;
  try {
    await remove(organizationId);
    await navigateTo('/organizations');
  } catch {
    failed.value = true;
  } finally {
    deleting.value = false;
    deleteOpen.value = false;
  }
}
</script>

<template>
  <AppStack gap="lg">
    <AppCard variant="elevated">
      <AppStack gap="lg">
        <AppHeading as="h1" size="lg">{{ t('organizations.settings.title') }}</AppHeading>
        <AppText color="muted">{{ t('organizations.settings.subtitle') }}</AppText>
        <AppAlert v-if="saved" variant="success">
          {{ t('organizations.settings.saved') }}
        </AppAlert>
        <AppAlert v-if="failed" variant="error">{{ t('organizations.settings.failed') }}</AppAlert>
        <AppStack as="form" gap="md" @submit.prevent="submit">
          <FormField
            id="organization-settings-name"
            :label="t('organizations.fieldName')"
            :error="nameError"
          >
            <AppInput
              id="organization-settings-name"
              v-model="nameInput"
              type="text"
              :disabled="pending"
              :has-error="nameError !== ''"
            />
          </FormField>
          <FormField
            id="organization-settings-slug"
            :label="t('organizations.fieldSlug')"
            :error="slugError"
          >
            <AppInput
              id="organization-settings-slug"
              v-model="slugInput"
              type="text"
              :disabled="pending"
              :has-error="slugError !== ''"
            />
          </FormField>
          <AppButton type="submit" :loading="pending">{{ t('common.actions.save') }}</AppButton>
        </AppStack>
      </AppStack>
    </AppCard>

    <AppCard variant="elevated">
      <AppStack gap="lg">
        <AppHeading as="h2" size="sm">{{ t('organizations.settings.grantsTitle') }}</AppHeading>
        <AppAlert v-if="grantsFailed" variant="error">
          {{ t('organizations.settings.grantsFailed') }}
        </AppAlert>
        <AppText v-if="grantsLoading && grants.length === 0">
          {{ t('common.states.loading') }}
        </AppText>
        <AppText v-else-if="grants.length === 0">
          {{ t('organizations.settings.grantsEmpty') }}
        </AppText>
        <GrantList
          v-else
          :grants="grants"
          :busy="grantsLoading"
          :can-revoke="canRevokeGrant"
          @revoke="revoke"
        />
      </AppStack>
    </AppCard>

    <AppCard v-if="canDelete" variant="elevated">
      <AppStack gap="md">
        <AppHeading as="h2" size="sm">{{ t('organizations.settings.deleteTitle') }}</AppHeading>
        <AppText color="muted">{{ t('organizations.settings.deleteWarning') }}</AppText>
        <AppButton variant="secondary" @click="deleteOpen = true">
          {{ t('organizations.settings.delete') }}
        </AppButton>
      </AppStack>
    </AppCard>

    <ConfirmDialog
      :open="deleteOpen"
      :title="t('organizations.settings.deleteConfirmTitle')"
      :message="t('organizations.settings.deleteConfirmMessage')"
      :confirm-label="t('organizations.settings.delete')"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="deleteOpen = false"
    />
  </AppStack>
</template>
