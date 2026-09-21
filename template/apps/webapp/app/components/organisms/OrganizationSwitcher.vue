<script setup lang="ts">
import type { Organization } from '__FORGE_SCOPE__/core/organizations/entities';

/**
 * Every organization the actor belongs to, each a way in.
 *
 * Presentational, for the reason `SessionList` gives: reading the list is
 * `useOrganization`'s. Unlike `SessionList`/`IdentityList` there is no verb to
 * emit — opening one is navigation, not a request, so each row is an
 * `AppLink` to that organization's own members screen rather than a button
 * with a handler.
 */
interface Props {
  /** The organizations to show. */
  organizations: readonly Organization[];
}

defineProps<Props>();

const { t } = useI18n();
</script>

<template>
  <AppTable>
    <AppTableHead>
      <AppTableCell header>{{ t('organizations.columnName') }}</AppTableCell>
      <AppTableCell header>{{ t('organizations.columnSlug') }}</AppTableCell>
      <AppTableCell header align="right">{{ t('organizations.columnActions') }}</AppTableCell>
    </AppTableHead>
    <AppTableBody>
      <AppTableRow v-for="organization in organizations" :key="organization.id">
        <AppTableCell emphasis="primary">{{ organization.name }}</AppTableCell>
        <AppTableCell>{{ organization.slug }}</AppTableCell>
        <AppTableCell align="right">
          <AppLink
            :to="`/organizations/${organization.id}/members`"
            variant="button-outline"
            size="sm"
          >
            {{ t('organizations.open') }}
          </AppLink>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
