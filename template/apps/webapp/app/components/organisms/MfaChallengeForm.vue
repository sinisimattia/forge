<script setup lang="ts">
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaChallengeMethodBody } from '~/types';

/**
 * The second step of signing in: a code from an authenticator, a recovery code,
 * or a passkey.
 *
 * ## One message, for every way this can fail
 *
 * There is a single failure string and it is shown for a wrong code, an expired
 * challenge, a spent one, a method that is not this account's, a recovery code
 * already used, a passkey the browser dismissed and a network fault. The backend
 * answers every refusal with one byte-identical `401` and records the reason
 * where only an operator can read it; a screen that said "that code has
 * expired" for one and "that code is wrong" for another would republish, in
 * prose, what the status line withholds from somebody who has proven a
 * password and nothing else. `mfa-challenge.spec.ts` drives distinct failures
 * and asserts the rendered text is identical.
 *
 * ## What a failure costs
 *
 * The backend spends the challenge before it looks at the proof, so a wrong
 * code ends the whole sign-in. When the store no longer holds a challenge this
 * form therefore stops offering inputs and offers the way back, instead of
 * inviting a second attempt that can only be refused.
 *
 * ## Where it does not decide
 *
 * It emits `verified` and navigates nowhere, for the reason `LoginForm` gives.
 */
const emit = defineEmits<{
  /** A session now exists. The page decides where the person goes. */
  verified: [];
}>();

const { challenge, passkeySupported, verifyCode, verifyRecoveryCode, verifyPasskey } = useMfa();
const { t } = useI18n();

type Mode = 'code' | 'recovery';

/**
 * The methods a code can be presented for. Empty when the list is unknown,
 * because a code is sent with the id of the method that produced it and a
 * challenge that arrived without a list has no id to send.
 */
const codeMethods = computed<readonly MfaChallengeMethodBody[]>(
  () => (challenge.value?.methods ?? []).filter((method) => method.type === MfaMethodType.TOTP),
);

/** Whether a passkey could satisfy this challenge, as far as this side knows. */
const offersPasskey = computed(() => {
  const methods = challenge.value?.methods ?? null;
  return methods === null || methods.some((method) => method.type === MfaMethodType.WEBAUTHN);
});

const browserHasPasskeys = ref(false);
const mode = ref<Mode>(codeMethods.value.length > 0 ? 'code' : 'recovery');
const methodId = ref(codeMethods.value[0]?.id ?? '');
const codeInput = ref('');
const recoveryInput = ref('');
const pending = ref(false);
const failed = ref(false);

const methodOptions = computed(
  () => codeMethods.value.map((method) => ({ value: method.id, label: method.label })),
);

onMounted(async () => {
  try {
    browserHasPasskeys.value = await passkeySupported();
  } catch {
    browserHasPasskeys.value = false;
  }
});

const toggleLabel = computed(
  () => (mode.value === 'code' ? t('auth.mfa.actions.useRecoveryCode') : t('auth.mfa.actions.useCode')),
);

async function run(action: () => Promise<void>): Promise<void> {
  pending.value = true;
  failed.value = false;
  try {
    await action();
    emit('verified');
  } catch {
    // Every fault, one flag, one string — see the component's own comment.
    failed.value = true;
  } finally {
    pending.value = false;
  }
}

function submitCode(): Promise<void> {
  return run(() => verifyCode(methodId.value, codeInput.value.trim()));
}

function submitRecoveryCode(): Promise<void> {
  return run(() => verifyRecoveryCode(recoveryInput.value.trim()));
}

function submitPasskey(): Promise<void> {
  return run(() => verifyPasskey());
}
</script>

<template>
  <AppStack gap="md">
    <AppAlert v-if="failed" variant="error">{{ t('auth.mfa.failed') }}</AppAlert>

    <template v-if="challenge !== null">
      <AppStack
        v-if="mode === 'code' && codeMethods.length > 0"
        as="form"
        gap="md"
        @submit.prevent="submitCode"
      >
        <FormField
          v-if="codeMethods.length > 1"
          id="mfa-method"
          :label="t('auth.mfa.fields.method')"
        >
          <AppSelect
            id="mfa-method"
            v-model="methodId"
            :options="methodOptions"
            :disabled="pending"
          />
        </FormField>
        <FormField id="mfa-code" :label="t('auth.mfa.fields.code')">
          <AppInput
            id="mfa-code"
            v-model="codeInput"
            :disabled="pending"
            autocomplete="one-time-code"
          />
        </FormField>
        <AppButton type="submit" :loading="pending">{{ t('auth.mfa.actions.verify') }}</AppButton>
      </AppStack>

      <AppStack
        v-else
        as="form"
        gap="md"
        @submit.prevent="submitRecoveryCode"
      >
        <AppText v-if="codeMethods.length === 0" color="muted">
          {{ t('auth.mfa.noCodeMethod') }}
        </AppText>
        <FormField id="mfa-recovery-code" :label="t('auth.mfa.fields.recoveryCode')">
          <AppInput
            id="mfa-recovery-code"
            v-model="recoveryInput"
            :disabled="pending"
            autocomplete="off"
          />
        </FormField>
        <AppButton type="submit" :loading="pending">{{ t('auth.mfa.actions.verify') }}</AppButton>
      </AppStack>

      <AppButton
        v-if="offersPasskey && browserHasPasskeys"
        id="mfa-passkey"
        variant="secondary"
        :disabled="pending"
        @click="submitPasskey"
      >
        {{ t('auth.mfa.actions.usePasskey') }}
      </AppButton>

      <AppButton
        v-if="codeMethods.length > 0"
        variant="ghost"
        :disabled="pending"
        @click="mode = mode === 'code' ? 'recovery' : 'code'"
      >
        {{ toggleLabel }}
      </AppButton>
    </template>

    <AppLink v-else to="/login">{{ t('auth.actions.backToSignIn') }}</AppLink>
  </AppStack>
</template>
