<script setup lang="ts">
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { formatInstant } from '~/utils/formatInstant';

/**
 * One organization's own audit history, newest first.
 *
 * `permission: 'audit:read'` — `ROLE_PERMISSIONS` gives it to OWNER and
 * ADMIN alone, and this page reads nothing else `useCan` would need to gate
 * a second time: there is nothing on this screen to do, only to read.
 *
 * There is no `AuditEntryList` organism: the plan names four, and a fifth
 * presentational wrapper around one `AppTable` with no verb to emit and no
 * second caller would be the mistake `STANDARDS.md`'s own "can this be
 * reused in a completely different context" question is there to catch.
 * `entry.action` is rendered as the raw value the backend recorded rather
 * than through a translated label: unlike `OrgRole` (four members, picked by
 * a person) or `AuthProvider` (`IdentityList`'s own label map), `AuditAction`
 * has 27 members today and grows with every action worth recording, most of
 * which never reach an organization-scoped read at all — a label map here
 * would be this package's least-used exhaustive switch, kept in step with an
 * enum this screen mostly never shows a member of.
 */
definePageMeta({
  layout: 'account',
  middleware: ['auth', 'permission'],
  permission: 'audit:read',
});

const route = useRoute();
const organizationId = route.params.organizationId as OrganizationId;

useOrganization().setActive(organizationId);

const { entries, loading, failed, load } = useAudit();
const { t } = useI18n();

useHead({ title: t('organizations.audit.title') });

onMounted(load);
</script>

<template>
  <AppCard variant="elevated">
    <AppStack gap="lg">
      <AppHeading as="h1" size="lg">{{ t('organizations.audit.title') }}</AppHeading>
      <AppText color="muted">{{ t('organizations.audit.subtitle') }}</AppText>
      <AppAlert v-if="failed" variant="error">{{ t('organizations.audit.failed') }}</AppAlert>
      <AppText v-if="loading && entries.length === 0">{{ t('common.states.loading') }}</AppText>
      <AppText v-else-if="entries.length === 0">{{ t('organizations.audit.empty') }}</AppText>
      <AppTable v-else>
        <AppTableHead>
          <AppTableCell header>{{ t('organizations.audit.columnAction') }}</AppTableCell>
          <AppTableCell header>{{ t('organizations.audit.columnActor') }}</AppTableCell>
          <AppTableCell header>{{ t('organizations.audit.columnOccurredAt') }}</AppTableCell>
        </AppTableHead>
        <AppTableBody>
          <AppTableRow v-for="entry in entries" :key="entry.id">
            <AppTableCell emphasis="primary">{{ entry.action }}</AppTableCell>
            <AppTableCell>
              {{ entry.actorId ?? t('organizations.audit.unknownActor') }}
            </AppTableCell>
            <AppTableCell>{{ formatInstant(entry.occurredAt, '') }}</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    </AppStack>
  </AppCard>
</template>
