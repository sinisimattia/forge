<script setup lang="ts">
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { OwnSession } from '~/types';
import { formatInstant } from '~/utils/formatInstant';

/**
 * Every session the person holds, and the one they are holding it with.
 *
 * Presentational: it is handed rows and emits an intention. The reading and the
 * revoking are `useSessions`', which is what keeps this organism testable
 * without a network and what stops a list component deciding when to refetch.
 *
 * ## The current session is marked and cannot be revoked from here
 *
 * Not because ending it is forbidden — it is exactly what signing out does — but
 * because a revoke button in a row of otherwise-identical rows is an
 * indistinguishable way to sign yourself out, and the person clicking it is
 * looking at a list of *other* places they are signed in. Signing out is a
 * separate, labelled act. `isCurrent` comes from the server, which is the only
 * party that can see which session served the request that fetched this list.
 */
interface Props {
  /** The sessions to show, newest first. */
  sessions: readonly OwnSession[];
  /** Whether a request is in flight; every control is disabled while it is. */
  busy?: boolean;
}

withDefaults(defineProps<Props>(), {
  busy: false,
});

const emit = defineEmits<{
  /** End that session. The parent does it and re-reads the list. */
  revoke: [sessionId: SessionId];
}>();

const { t } = useI18n();
</script>

<template>
  <AppTable>
    <AppTableHead>
      <AppTableCell header>{{ t('account.sessions.columnClient') }}</AppTableCell>
      <AppTableCell header>{{ t('account.sessions.columnAddress') }}</AppTableCell>
      <AppTableCell header>{{ t('account.sessions.columnLastUsed') }}</AppTableCell>
      <AppTableCell header>{{ t('account.sessions.columnExpires') }}</AppTableCell>
      <AppTableCell header align="right">{{ t('account.sessions.columnActions') }}</AppTableCell>
    </AppTableHead>
    <AppTableBody>
      <AppTableRow v-for="row in sessions" :key="row.session.id">
        <AppTableCell emphasis="primary">
          {{ row.session.clientLabel ?? t('account.sessions.unknownClient') }}
          <AppBadge v-if="row.isCurrent" color="primary" size="sm">
            {{ t('account.sessions.current') }}
          </AppBadge>
        </AppTableCell>
        <AppTableCell>
          {{ row.session.clientAddress ?? t('account.sessions.unknownAddress') }}
        </AppTableCell>
        <AppTableCell>{{ formatInstant(row.session.lastUsedAt, '') }}</AppTableCell>
        <AppTableCell>{{ formatInstant(row.session.expiresAt, '') }}</AppTableCell>
        <AppTableCell align="right">
          <AppButton
            v-if="!row.isCurrent"
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="emit('revoke', row.session.id)"
          >
            {{ t('account.sessions.revoke') }}
          </AppButton>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
