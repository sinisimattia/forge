<script setup lang="ts">
import type { Invitation } from '__FORGE_SCOPE__/core/organizations/entities';
import type { InvitationId } from '__FORGE_SCOPE__/core/organizations/types';
import { formatInstant } from '~/utils/formatInstant';
import { ORG_ROLE_LABEL_KEYS } from '~/utils/organizationRoles';

/**
 * One organization's open invitations.
 *
 * Presentational, for the reason `SessionList` gives: reading and revoking
 * are `useInvitations`'. Sending a new one is not this component's concern
 * either — it lives on the page, beside the form that collects an address
 * and a role, because a list has nothing to validate and a form is not a row.
 */
interface Props {
  /** The invitations to show. */
  invitations: readonly Invitation[];
  /** Whether a request is in flight; every control is disabled while it is. */
  busy?: boolean;
  /** Whether the actor may revoke an invitation. */
  canRevoke?: boolean;
}

withDefaults(defineProps<Props>(), {
  busy: false,
  canRevoke: false,
});

const emit = defineEmits<{
  /** Withdraw this invitation. The parent does it and re-reads the list. */
  revoke: [invitationId: InvitationId];
}>();

const { t } = useI18n();
</script>

<template>
  <AppTable>
    <AppTableHead>
      <AppTableCell header>{{ t('organizations.invitations.columnEmail') }}</AppTableCell>
      <AppTableCell header>{{ t('organizations.invitations.columnRole') }}</AppTableCell>
      <AppTableCell header>{{ t('organizations.invitations.columnExpires') }}</AppTableCell>
      <AppTableCell header align="right">
        {{ t('organizations.invitations.columnActions') }}
      </AppTableCell>
    </AppTableHead>
    <AppTableBody>
      <AppTableRow v-for="invitation in invitations" :key="invitation.id">
        <AppTableCell emphasis="primary">{{ invitation.email }}</AppTableCell>
        <AppTableCell>{{ t(ORG_ROLE_LABEL_KEYS[invitation.role]) }}</AppTableCell>
        <AppTableCell>{{ formatInstant(invitation.expiresAt, '') }}</AppTableCell>
        <AppTableCell align="right">
          <AppButton
            v-if="canRevoke"
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="emit('revoke', invitation.id)"
          >
            {{ t('organizations.invitations.revoke') }}
          </AppButton>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
