<script setup lang="ts">
import type { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { PROVIDER_LABEL_KEYS } from '~/utils/providerLabels';
import { formatInstant } from '~/utils/formatInstant';

/**
 * Every way the person can prove who they are, one they do not hold yet for
 * each configured provider still open to them, and a way to remove or add one.
 *
 * Presentational, for the reason `SessionList` gives: reading, linking and
 * unlinking are `useIdentities`'.
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
 * person can click and would change nothing about what can happen. Offering a
 * link control does not change that either — linking only ever adds a way in,
 * so it carries no version of this rule to enforce or to hide behind.
 */
interface Props {
  /** The identities to show. */
  identities: readonly AuthIdentity[];
  /**
   * The federated providers this deployment has configured, in the order to
   * offer them. A provider already held is not offered again — see
   * {@link linkable} — and a provider absent from this list is never offered
   * at all, the same "absent, not empty" rule `OAuthButtons` follows for the
   * same reason (ADR-0008).
   */
  providers?: readonly AuthProvider[];
  /** Whether a request is in flight; every control is disabled while it is. */
  busy?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  providers: () => [],
  busy: false,
});

const emit = defineEmits<{
  /** Unlink that identity. The parent does it and re-reads the list. */
  unlink: [identityId: AuthIdentityId];
  /** Link that provider. The parent does it, and navigates away to do so. */
  link: [provider: AuthProvider];
}>();

const { t } = useI18n();

/** Whether unlinking anything is offered at all. See this component's own note. */
const unlinkable = computed(() => props.identities.length > 1);

/** `providers`, minus whichever ones the account already holds. */
const linkable = computed(() => {
  const held = new Set(props.identities.map((identity) => identity.provider));
  return props.providers.filter((provider) => !held.has(provider));
});
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
      <AppTableRow v-for="provider in linkable" :key="provider">
        <AppTableCell emphasis="primary">{{ t(PROVIDER_LABEL_KEYS[provider]) }}</AppTableCell>
        <AppTableCell />
        <AppTableCell />
        <AppTableCell align="right">
          <AppButton
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="emit('link', provider)"
          >
            {{ t('account.identities.link') }}
          </AppButton>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
