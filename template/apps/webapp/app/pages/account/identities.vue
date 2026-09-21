<script setup lang="ts">
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';

/**
 * Every way the person can prove who they are, a way to add another, and a
 * way to remove one.
 *
 * Read after mount, for the reason `sessions.vue` gives — both the held
 * identities and the deployment's configured providers, so `IdentityList`
 * can tell "already held" apart from "never offered" for itself.
 *
 * `lastRemaining` is rendered separately from `failed` because it is the one
 * refusal with a remedy: add another way in first. The rule behind it is core's
 * `assertAtLeastOneIdentityRemains`, applied by the server; `IdentityList` hides
 * the control when one identity is left, which is an affordance and not the rule.
 */
definePageMeta({
  layout: 'account',
  middleware: 'auth',
});

const { identities, loading, failed, lastRemaining, load, unlink, link } = useIdentities();
const { providers, load: loadProviders } = useOAuthProviders();
const { t } = useI18n();

useHead({ title: t('account.identities.title') });

onMounted(() => {
  void load();
  void loadProviders();
});

async function onUnlink(identityId: AuthIdentityId): Promise<void> {
  await unlink(identityId);
}

/**
 * Begins linking `provider`. This leaves the page — see `useIdentities.link`'s
 * own TSDoc for why nothing follows this `await` on the way out.
 */
async function onLink(provider: AuthProvider): Promise<void> {
  await link(provider);
}
</script>

<template>
  <AppCard variant="elevated">
    <AppStack gap="lg">
      <AppHeading as="h1" size="lg">{{ t('account.identities.title') }}</AppHeading>
      <AppText color="muted">{{ t('account.identities.subtitle') }}</AppText>
      <AppAlert v-if="lastRemaining" variant="warning">
        {{ t('account.identities.lastRemaining') }}
      </AppAlert>
      <AppAlert v-if="failed" variant="error">{{ t('account.identities.failed') }}</AppAlert>
      <AppText v-if="loading && identities.length === 0">{{ t('common.states.loading') }}</AppText>
      <AppText v-else-if="identities.length === 0">{{ t('account.identities.empty') }}</AppText>
      <IdentityList
        v-else
        :identities="identities"
        :providers="providers"
        :busy="loading"
        @unlink="onUnlink"
        @link="onLink"
      />
    </AppStack>
  </AppCard>
</template>
