<script setup lang="ts">
import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import { formatInstant } from '~/utils/formatInstant';

/**
 * The actor's second-factor methods: what each is called, what kind it is, whether
 * enrollment was finished, when it was last used, and a way to remove it.
 *
 * Presentational, for the reason `SessionList` gives: reading and removing are
 * `useMfaMethods`'.
 *
 * ## It shows what the listing endpoint returns and invents nothing
 *
 * `MfaMethodJSON` has no field for a secret, a public key or a counter, so there
 * is nothing here that could render one. The columns are the fields that exist:
 * `label`, `type`, `confirmedAt` and `lastUsedAt`.
 *
 * ## Every row can be removed, and that is deliberate
 *
 * Unlike `IdentityList`, this does **not** hide the control on the last method.
 * Whether a removal needs a proof is the server's decision, and it answers
 * `MFA_REAUTHENTICATION_REQUIRED` when it does; the composable turns that into
 * the proof form. Hiding the control at one method would take away the only way
 * to turn the second factor off, which is a legitimate thing to want.
 */
interface Props {
  /** The methods to show. */
  methods: readonly MfaMethodJSON[];
  /** Whether a request is in flight; every control is disabled while it is. */
  busy?: boolean;
}

withDefaults(defineProps<Props>(), { busy: false });

const emit = defineEmits<{
  /** Remove that method. The parent asks the server, and raises the proof form if it wants one. */
  remove: [methodId: string];
}>();

const { t } = useI18n();

const TYPE_LABEL_KEYS: Record<MfaMethodType, string> = {
  [MfaMethodType.TOTP]: 'account.mfa.typeTotp',
  [MfaMethodType.WEBAUTHN]: 'account.mfa.typeWebauthn',
};

/** `confirmedAt` as a date, or `null` while enrollment is unfinished. */
function instantOf(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/** "Added Sep 1, 2026, 9:05 AM". */
function confirmedOn(value: string | null): string {
  return t('account.mfa.confirmedOn', { date: formatInstant(instantOf(value), '') });
}
</script>

<template>
  <AppTable>
    <AppTableHead>
      <AppTableCell header>{{ t('account.mfa.columnName') }}</AppTableCell>
      <AppTableCell header>{{ t('account.mfa.columnType') }}</AppTableCell>
      <AppTableCell header>{{ t('account.mfa.columnStatus') }}</AppTableCell>
      <AppTableCell header>{{ t('account.mfa.columnLastUsed') }}</AppTableCell>
      <AppTableCell header align="right">{{ t('account.mfa.columnActions') }}</AppTableCell>
    </AppTableHead>
    <AppTableBody>
      <AppTableRow v-for="method in methods" :key="method.id">
        <AppTableCell emphasis="primary">{{ method.label }}</AppTableCell>
        <AppTableCell>{{ t(TYPE_LABEL_KEYS[method.type]) }}</AppTableCell>
        <AppTableCell>
          <AppBadge v-if="method.confirmedAt === null" color="warning" size="sm">
            {{ t('account.mfa.unconfirmed') }}
          </AppBadge>
          <template v-else>
            {{ confirmedOn(method.confirmedAt) }}
          </template>
        </AppTableCell>
        <AppTableCell>
          {{ formatInstant(instantOf(method.lastUsedAt), t('account.mfa.neverUsed')) }}
        </AppTableCell>
        <AppTableCell align="right">
          <AppButton
            variant="secondary"
            size="sm"
            :disabled="busy"
            @click="emit('remove', method.id)"
          >
            {{ t('account.mfa.remove') }}
          </AppButton>
        </AppTableCell>
      </AppTableRow>
    </AppTableBody>
  </AppTable>
</template>
