<script setup lang="ts">
import type { GrantId, ResourceGrant } from '__FORGE_SCOPE__/core/authorization/types';
import { formatInstant } from '~/utils/formatInstant';

/**
 * One organization's resource grants — layer three's exceptions, each one
 * person, one record, one permission.
 *
 * Presentational, for the reason `SessionList` gives: reading and revoking
 * are `useGrants`'. There is no way to issue one from here, and
 * `useGrants`'s own TSDoc explains why: doing so needs a `Permission`
 * picked from a list, and nothing in this application enumerates one
 * (ADR-0006, `useCan`'s own exhaustiveness proof). This component only
 * ever renders a grant's own `permission` field back out as a value, which
 * needs no such list.
 */
interface Props {
  /** The grants to show. */
  grants: readonly ResourceGrant[];
  /** Whether a request is in flight; every control is disabled while it is. */
  busy?: boolean;
  /** Whether the actor may revoke a grant. */
  canRevoke?: boolean;
}

withDefaults(defineProps<Props>(), {
  busy: false,
  canRevoke: false,
});

const emit = defineEmits<{
  /** Revoke this grant. The parent does it and re-reads the list. */
  revoke: [grantId: GrantId];
}>();

const { t } = useI18n();
</script>

<template>
  <AppTable>
    <AppTableHead>
      <AppTableCell header>{{ t('organizations.settings.columnSubject') }}</AppTableCell>
      <AppTableCell header>{{ t('organizations.settings.columnResource') }}</AppTableCell>
      <AppTableCell header>{{ t('organizations.settings.columnPermission') }}</AppTableCell>
      <AppTableCell header>{{ t('organizations.settings.columnExpires') }}</AppTableCell>
      <AppTableCell header align="right">
        {{ t('organizations.settings.columnActions') }}
      </AppTableCell>
    </AppTableHead>
    <AppTableBody>
      <AppTableRow v-for="grant in grants" :key="grant.id">
        <AppTableCell emphasis="primary">{{ grant.subjectUserId }}</AppTableCell>
        <AppTableCell>{{ grant.resourceType }}/{{ grant.resourceId }}</AppTableCell>
        <AppTableCell>{{ grant.permission }}</AppTableCell>
        <AppTableCell>
          {{ formatInstant(grant.expiresAt, t('organizations.settings.never')) }}
        </AppTableCell>
        <AppTableCell align="right">
          <AppButton
            v-if="canRevoke"
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="emit('revoke', grant.id)"
          >
            {{ t('organizations.settings.grantsRevoke') }}
          </AppButton>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
