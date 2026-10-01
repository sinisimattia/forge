<script setup lang="ts">
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { MfaProofBody } from '~/types';
import type { ProofReason } from '~/composables/useMfaMethods';

/**
 * A live proof of the second factor, asked for because the action needs one.
 *
 * ## It says why, and it says two different things
 *
 * - `required` — the server refused because no proof came with the request
 *   (`403`, `MFA_REAUTHENTICATION_REQUIRED`). Removing the last method is a way
 *   of removing the requirement, and a signed-in tab is not enough to authorise
 *   that; nor is it enough to add a second factor, which would let a hijacked tab
 *   enrol one of its own. This is the rule doing its job, so the text explains
 *   the rule and does not read as an error.
 * - `wrong` — a proof was sent and did not check out (`422`), or was a recovery
 *   code already spent. The remedy is different (try another), and the text is
 *   an error.
 *
 * A form that answered both with "something went wrong" would look like a bug in
 * the first case and give no direction in the second.
 *
 * ## What can prove
 *
 * A code from a confirmed authenticator app, or an unused recovery code — never
 * both at once, which is why the two are separate modes and the emitted proof
 * has one arm or the other. A passkey cannot produce a typed code, so it is not
 * offered here.
 */
interface Props {
  /** What the proof unlocks, which picks the wording. */
  action: 'remove' | 'regenerate' | 'confirmTotp' | 'enrollPasskey';
  /** Why the form is showing. */
  reason: ProofReason;
  /** The account's methods; the confirmed authenticator apps among them can supply a code. */
  methods: readonly MfaMethodJSON[];
  /** Whether a request is in flight. */
  busy?: boolean;
}

const props = withDefaults(defineProps<Props>(), { busy: false });

const emit = defineEmits<{
  /** A proof of exactly one kind. */
  submit: [proof: MfaProofBody];
  /** The person backed out. */
  cancel: [];
}>();

const { t } = useI18n();

const codeMethods = computed(
  () => props.methods.filter(
    (method) => method.type === MfaMethodType.TOTP && method.confirmedAt !== null,
  ),
);

const mode = ref<'code' | 'recovery'>(codeMethods.value.length > 0 ? 'code' : 'recovery');
const methodId = ref(codeMethods.value[0]?.id ?? '');
const codeInput = ref('');
const recoveryInput = ref('');

const requiredKey = computed(() => {
  if (props.action === 'remove') return 'account.mfa.proof.requiredRemove';
  if (props.action === 'regenerate') return 'account.mfa.proof.requiredRegenerate';
  return 'account.mfa.proof.requiredEnroll';
});

const methodOptions = computed(
  () => codeMethods.value.map((method) => ({ value: method.id, label: method.label })),
);

const toggleLabel = computed(
  () => t(mode.value === 'code' ? 'account.mfa.proof.useRecovery' : 'account.mfa.proof.useCode'),
);

function submit(): void {
  if (mode.value === 'code') {
    emit('submit', { methodId: methodId.value, code: codeInput.value.trim() });
  } else {
    emit('submit', { recoveryCode: recoveryInput.value.trim() });
  }
}
</script>

<template>
  <AppStack gap="md">
    <AppHeading as="h2" size="md">{{ t('account.mfa.proof.title') }}</AppHeading>
    <AppAlert v-if="reason === 'required'" variant="info">
      {{ t(requiredKey) }}
    </AppAlert>
    <AppAlert v-else variant="error">{{ t('account.mfa.proof.wrong') }}</AppAlert>
    <AppStack as="form" gap="md" @submit.prevent="submit">
      <template v-if="mode === 'code'">
        <FormField
          v-if="codeMethods.length > 1"
          id="proof-method"
          :label="t('account.mfa.proof.method')"
        >
          <AppSelect
            id="proof-method"
            v-model="methodId"
            :options="methodOptions"
            :disabled="busy"
          />
        </FormField>
        <FormField id="proof-code" :label="t('account.mfa.proof.code')">
          <AppInput
            id="proof-code"
            v-model="codeInput"
            :disabled="busy"
            autocomplete="one-time-code"
          />
        </FormField>
      </template>
      <FormField v-else id="proof-recovery-code" :label="t('account.mfa.proof.recoveryCode')">
        <AppInput
          id="proof-recovery-code"
          v-model="recoveryInput"
          :disabled="busy"
          autocomplete="off"
        />
      </FormField>
      <AppStack direction="row" gap="md" wrap>
        <AppButton type="submit" :loading="busy">{{ t('account.mfa.proof.submit') }}</AppButton>
        <AppButton
          v-if="codeMethods.length > 0"
          variant="ghost"
          :disabled="busy"
          @click="mode = mode === 'code' ? 'recovery' : 'code'"
        >
          {{ toggleLabel }}
        </AppButton>
        <AppButton variant="ghost" :disabled="busy" @click="emit('cancel')">
          {{ t('common.actions.cancel') }}
        </AppButton>
      </AppStack>
    </AppStack>
  </AppStack>
</template>
