<script setup lang="ts">
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { ORG_ROLE_LABEL_KEYS } from '~/utils/organizationRoles';

/**
 * One organization's open invitations, and a form to send another.
 *
 * `permission: 'invitation:read'` — `ROLE_PERMISSIONS` gives it to OWNER and
 * ADMIN only, together with `member:invite` and `invitation:revoke`, which
 * `InvitationList` and this page's own form gate independently. All three
 * are organization ROLE questions, so none needs anything but
 * `organizationId`.
 */
definePageMeta({
  layout: 'account',
  middleware: ['auth', 'permission'],
  permission: 'invitation:read',
});

const route = useRoute();
const organizationId = route.params.organizationId as OrganizationId;

useOrganization().setActive(organizationId);

const { invitations, loading, failed, load, invite, revoke } = useInvitations();
const canInvite = useCan('member:invite', { organizationId });
const canRevoke = useCan('invitation:revoke', { organizationId });
const { t } = useI18n();

useHead({ title: t('organizations.invitations.title') });

onMounted(load);

const emailInput = ref('');
const roleInput = ref<string>(OrgRole.MEMBER);
const emailError = ref('');

const ROLE_OPTIONS = Object.values(OrgRole).map((role) => ({
  value: role,
  label: t(ORG_ROLE_LABEL_KEYS[role]),
}));

async function submit(): Promise<void> {
  emailError.value = '';
  if (emailInput.value.trim() === '') {
    emailError.value = t('organizations.invitations.emailRequired');
    return;
  }
  await invite(emailInput.value, roleInput.value as OrgRole);
  if (!failed.value) emailInput.value = '';
}
</script>

<template>
  <AppStack gap="lg">
    <AppCard variant="elevated">
      <AppStack gap="lg">
        <AppHeading as="h1" size="lg">{{ t('organizations.invitations.title') }}</AppHeading>
        <AppText color="muted">{{ t('organizations.invitations.subtitle') }}</AppText>
        <AppAlert v-if="failed" variant="error">
          {{ t('organizations.invitations.failed') }}
        </AppAlert>
        <AppText v-if="loading && invitations.length === 0">
          {{ t('common.states.loading') }}
        </AppText>
        <AppText v-else-if="invitations.length === 0">
          {{ t('organizations.invitations.empty') }}
        </AppText>
        <InvitationList
          v-else
          :invitations="invitations"
          :busy="loading"
          :can-revoke="canRevoke"
          @revoke="revoke"
        />
      </AppStack>
    </AppCard>

    <AppCard v-if="canInvite" variant="elevated">
      <AppStack gap="lg">
        <AppHeading as="h2" size="sm">{{ t('organizations.invitations.invite') }}</AppHeading>
        <AppStack as="form" gap="md" @submit.prevent="submit">
          <FormField
            id="invite-email"
            :label="t('organizations.invitations.fieldEmail')"
            :error="emailError"
          >
            <AppInput
              id="invite-email"
              v-model="emailInput"
              type="email"
              :disabled="loading"
              :has-error="emailError !== ''"
            />
          </FormField>
          <FormField id="invite-role" :label="t('organizations.invitations.fieldRole')">
            <AppSelect
              id="invite-role"
              v-model="roleInput"
              :options="ROLE_OPTIONS"
              :disabled="loading"
            />
          </FormField>
          <AppButton type="submit" :loading="loading">
            {{ t('organizations.invitations.invite') }}
          </AppButton>
        </AppStack>
      </AppStack>
    </AppCard>
  </AppStack>
</template>
