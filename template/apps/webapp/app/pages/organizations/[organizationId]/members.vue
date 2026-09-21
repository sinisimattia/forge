<script setup lang="ts">
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';

/**
 * Everyone who belongs to one organization, and their role.
 *
 * `permission: 'member:read'` — the one permission every control on this
 * page needs at least a little of. `MemberList`'s own two booleans
 * (`member:update`, `member:remove`) gate the finer controls; both are still
 * organization ROLE questions, so neither needs anything but
 * `organizationId` either.
 */
definePageMeta({
  layout: 'account',
  middleware: ['auth', 'permission'],
  permission: 'member:read',
});

const route = useRoute();
const organizationId = route.params.organizationId as OrganizationId;

useOrganization().setActive(organizationId);

const { members, loading, failed, load, updateRole, remove } = useMembers();
const canChangeRole = useCan('member:update', { organizationId });
const canRemove = useCan('member:remove', { organizationId });
const { t } = useI18n();

useHead({ title: t('organizations.members.title') });

onMounted(load);
</script>

<template>
  <AppCard variant="elevated">
    <AppStack gap="lg">
      <AppHeading as="h1" size="lg">{{ t('organizations.members.title') }}</AppHeading>
      <AppText color="muted">{{ t('organizations.members.subtitle') }}</AppText>
      <AppAlert v-if="failed" variant="error">{{ t('organizations.members.failed') }}</AppAlert>
      <AppText v-if="loading && members.length === 0">{{ t('common.states.loading') }}</AppText>
      <AppText v-else-if="members.length === 0">{{ t('organizations.members.empty') }}</AppText>
      <MemberList
        v-else
        :members="members"
        :busy="loading"
        :can-change-role="canChangeRole"
        :can-remove="canRemove"
        @update-role="updateRole"
        @remove="remove"
      />
    </AppStack>
  </AppCard>
</template>
