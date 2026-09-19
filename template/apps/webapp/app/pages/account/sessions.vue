<script setup lang="ts">
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';

/**
 * Everywhere the person is signed in, and a way to end any of it.
 *
 * The list is read after mount rather than during the render. It needs the access
 * credential, which on the server exists only after the renewal plugin has run —
 * and a page that fetched during SSR would fetch again on hydration, which is two
 * requests for one screen. `load()` once, in the browser.
 */
definePageMeta({
  layout: 'account',
  middleware: 'auth',
});

const { sessions, loading, failed, load, revoke } = useSessions();
const { t } = useI18n();

useHead({ title: t('account.sessions.title') });

onMounted(load);

async function onRevoke(sessionId: SessionId): Promise<void> {
  await revoke(sessionId);
}
</script>

<template>
  <AppCard variant="elevated">
    <AppStack gap="lg">
      <AppHeading as="h1" size="lg">{{ t('account.sessions.title') }}</AppHeading>
      <AppText color="muted">{{ t('account.sessions.subtitle') }}</AppText>
      <AppAlert v-if="failed" variant="error">{{ t('account.sessions.failed') }}</AppAlert>
      <AppText v-if="loading && sessions.length === 0">{{ t('common.states.loading') }}</AppText>
      <AppText v-else-if="sessions.length === 0">{{ t('account.sessions.empty') }}</AppText>
      <SessionList v-else :sessions="sessions" :busy="loading" @revoke="onRevoke" />
    </AppStack>
  </AppCard>
</template>
