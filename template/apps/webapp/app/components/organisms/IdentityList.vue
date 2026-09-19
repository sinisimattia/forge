<script setup lang="ts">
import type { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { formatInstant } from '~/utils/formatInstant';

/**
 * Every way the person can prove who they are.
 *
 * Presentational, for the reason `SessionList` gives: reading and unlinking are
 * `useIdentities`'.
 *
 * ## The unlink control disappears at one identity, and that is not the rule
 *
 * The rule — "a user must always keep at least one way in" — is core's
 * `assertAtLeastOneIdentityRemains`, applied on the side that can see every
 * identity the account holds. This component does **not** enforce it and must
 * not be read as doing so: it hides a control that would certainly be refused,
 * which is an affordance, not a decision. If the count this screen is holding is
 * stale, the server still refuses, and `useIdentities` surfaces that refusal
 * under its own name.
 *
 * Stated the other way round: deleting the `v-if` below would change what a
 * person can click and would change nothing about what can happen.
 */
interface Props {
  /** The identities to show. */
  identities: readonly AuthIdentity[];
  /** Whether a request is in flight; every control is disabled while it is. */
  busy?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  busy: false,
});

const emit = defineEmits<{
  /** Unlink that identity. The parent does it and re-reads the list. */
  unlink: [identityId: AuthIdentityId];
}>();

const { t } = useI18n();

/**
 * One translation key per provider.
 *
 * A `Record` over core's enum, so a provider added there is a compile error here
 * rather than a row labelled with a raw enum value.
 */
const PROVIDER_LABEL_KEYS: Record<AuthProvider, string> = {
  [AuthProvider.PASSWORD]: 'account.identities.providerPassword',
  [AuthProvider.GOOGLE]: 'account.identities.providerGoogle',
  [AuthProvider.GITHUB]: 'account.identities.providerGithub',
  [AuthProvider.OIDC]: 'account.identities.providerOidc',
};

/** Whether unlinking anything is offered at all. See this component's own note. */
const unlinkable = computed(() => props.identities.length > 1);
</script>

<template>
  <AppTable>
    <AppTableHead>
      <AppTableCell header>{{ t('account.identities.columnProvider') }}</AppTableCell>
      <AppTableCell header>{{ t('account.identities.columnAccount') }}</AppTableCell>
      <AppTableCell header>{{ t('account.identities.columnLastUsed') }}</AppTableCell>
      <AppTableCell header align="right">{{ t('account.identities.columnActions') }}</AppTableCell>
    </AppTableHead>
    <AppTableBody>
      <AppTableRow v-for="identity in identities" :key="identity.id">
        <AppTableCell emphasis="primary">
          {{ t(PROVIDER_LABEL_KEYS[identity.provider]) }}
        </AppTableCell>
        <AppTableCell>{{ identity.providerAccountId }}</AppTableCell>
        <AppTableCell>
          {{ formatInstant(identity.lastUsedAt, t('account.identities.neverUsed')) }}
        </AppTableCell>
        <AppTableCell align="right">
          <AppButton
            v-if="unlinkable"
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="emit('unlink', identity.id)"
          >
            {{ t('account.identities.unlink') }}
          </AppButton>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
