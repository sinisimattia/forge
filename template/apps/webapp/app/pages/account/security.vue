<script setup lang="ts">
import { onBeforeRouteLeave } from 'vue-router';
import { InvalidCredentialsError } from '__FORGE_SCOPE__/core/auth/errors';
import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';

/**
 * Changing the secret the person holds, and managing the second factor on top of it.
 *
 * ## The second factor
 *
 * Everything below `useMfaMethods()` is the second-factor half: the list, an
 * enrollment, the recovery codes, and the proof form.
 *
 * **Where the secrets go.** The TOTP secret and the recovery codes pass through
 * this page. They live in refs inside `useMfaMethods` — never in a Pinia store,
 * `useState`, `useAsyncData` or storage — and are set only by a request the
 * person makes after the page is already running in their browser, so no server
 * render can have them. `pages/__tests__/security-mfa.spec.ts` asserts none of it
 * reaches the store's state or `history.state`, and that a fresh mount of the
 * page has no way to show a batch that was dismissed.
 *
 * A failure with no name of its own (`account.mfa.failed`) is rendered above the
 * branch chain, so it is visible whichever step raised it.
 *
 * ## The password goes through the store, not through a service
 *
 * The backend ends every session the user holds and opens a fresh one for the
 * request it is serving, so the answer carries a new access credential — exactly
 * as a sign-in does. `useAuth().changePassword` takes it up. A page that called
 * `AuthHttpService.changePassword` itself would leave the application presenting
 * a credential the server had just killed, and the symptom would be "changing my
 * password signs me out", arriving one request later.
 *
 * The other sessions really are gone, and the page says so: somebody who is
 * signed in on a phone will be asked for the new secret there, which is the whole
 * point of ending them and is alarming if unannounced.
 */
definePageMeta({
  layout: 'account',
  middleware: 'auth',
});

const { changePassword } = useAuth();
const mfa = useMfaMethods();
const { t } = useI18n();

useHead({ title: t('account.security.title') });

const currentSecretInput = ref('');
const newSecretInput = ref('');
const pending = ref(false);
const changed = ref(false);
const wrongCurrent = ref(false);
const failed = ref(false);
const reportedViolations = ref<readonly PasswordPolicyViolation[]>([]);

/** Whether the person has said they kept the recovery codes now on screen. */
const codesKept = ref(false);

watch(mfa.recoveryCodes, () => {
  codesKept.value = false;
});

/**
 * Following a link in the application while the recovery codes are on screen and
 * unkept drops ten codes that exist nowhere else. Ask first; a "no" stays here.
 * Here and not in the panel because a route guard needs a route component.
 */
onBeforeRouteLeave(
  () => mfa.recoveryCodes.value === null
    || codesKept.value
    || window.confirm(t('account.mfa.recovery.leaveWarning')),
);

const totpLabel = ref('');
const passkeyLabel = ref('');
const passkeysAvailable = ref(false);

onMounted(async () => {
  void mfa.load();
  passkeysAvailable.value = await mfa.passkeySupported();
});

/**
 * At or below this many unspent recovery codes the screen warns. The number is a
 * presentation choice and not a rule of the server's: it only decides when a
 * count is worth interrupting for.
 */
const LOW_RECOVERY_CODES = 3;

const recoveryCodesLow = computed(
  () => mfa.recoveryCodesRemaining.value !== null
    && mfa.recoveryCodesRemaining.value <= LOW_RECOVERY_CODES,
);

const hasConfirmedMethod = computed(
  () => mfa.methods.value.some((method) => method.confirmedAt !== null),
);

async function startTotp(): Promise<void> {
  await mfa.beginTotp(totpLabel.value);
  if (mfa.enrollment.value !== null) totpLabel.value = '';
}

async function startPasskey(): Promise<void> {
  await mfa.enrollPasskey(passkeyLabel.value);
  if (!mfa.labelMissing.value && !mfa.failed.value) passkeyLabel.value = '';
}

async function submit(): Promise<void> {
  pending.value = true;
  changed.value = false;
  wrongCurrent.value = false;
  failed.value = false;
  reportedViolations.value = [];
  try {
    await changePassword(currentSecretInput.value, newSecretInput.value);
    changed.value = true;
    currentSecretInput.value = '';
    newSecretInput.value = '';
  } catch (error) {
    // Naming this one is not an enumeration risk: whoever is here has already
    // proved they hold the account, so "that is not your current password" tells
    // them something only they can act on and tells a stranger nothing.
    if (error instanceof InvalidCredentialsError) wrongCurrent.value = true;
    else if (error instanceof WeakPasswordError) reportedViolations.value = error.violations;
    else failed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppStack gap="xl">
    <AppCard variant="elevated">
      <AppStack gap="lg">
        <AppHeading as="h1" size="lg">{{ t('account.security.title') }}</AppHeading>
        <AppHeading as="h2" size="md">{{ t('account.security.passwordHeading') }}</AppHeading>
        <AppAlert v-if="changed" variant="success">{{ t('account.security.changed') }}</AppAlert>
        <AppAlert v-if="wrongCurrent" variant="error">
          {{ t('account.security.wrongCurrent') }}
        </AppAlert>
        <AppAlert v-if="failed" variant="error">{{ t('account.security.failed') }}</AppAlert>
        <AppAlert variant="info">{{ t('account.security.endsOtherSessions') }}</AppAlert>
        <AppStack as="form" gap="md" @submit.prevent="submit">
          <PasswordField
            id="security-current"
            v-model="currentSecretInput"
            :label="t('auth.fields.currentPassword')"
            :disabled="pending"
            autocomplete="current-password"
          />
          <PasswordField
            id="security-new"
            v-model="newSecretInput"
            :label="t('auth.fields.newPassword')"
            :disabled="pending"
            :reported-violations="reportedViolations"
            autocomplete="new-password"
            check-policy
          />
          <AppButton type="submit" :loading="pending">
            {{ t('auth.actions.setPassword') }}
          </AppButton>
        </AppStack>
      </AppStack>
    </AppCard>

    <AppCard variant="elevated">
      <AppStack gap="lg">
        <!--
          Above the branch chain, not inside its last branch: a failure with no
          name can come from the confirmation form and the proof form as well as
          from the list, and the last branch alone left those two silent.
        -->
        <AppAlert v-if="mfa.failed.value" variant="error">{{ t('account.mfa.failed') }}</AppAlert>
        <RecoveryCodesPanel
          v-if="mfa.recoveryCodes.value !== null"
          v-model:saved="codesKept"
          :codes="mfa.recoveryCodes.value"
          @dismiss="mfa.dismissRecoveryCodes"
        />
        <MfaProofForm
          v-else-if="mfa.proofRequest.value !== null"
          :action="mfa.proofRequest.value.action"
          :reason="mfa.proofRequest.value.reason"
          :methods="mfa.methods.value"
          :busy="mfa.loading.value"
          @submit="mfa.submitProof"
          @cancel="mfa.cancelProof"
        />
        <TotpEnrollment
          v-else-if="mfa.enrollment.value !== null"
          :offer="mfa.enrollment.value"
          :busy="mfa.loading.value"
          :wrong-code="mfa.wrongCode.value"
          @confirm="mfa.confirmTotp"
          @cancel="mfa.cancelEnrollment"
        />
        <template v-else>
          <AppHeading as="h2" size="md">{{ t('account.mfa.title') }}</AppHeading>
          <AppText color="muted">{{ t('account.mfa.subtitle') }}</AppText>
          <AppAlert v-if="mfa.passkeyRestart.value" variant="warning">
            {{ t('account.mfa.passkeyRestart') }}
          </AppAlert>
          <AppAlert v-if="mfa.passkeyDismissed.value" variant="warning">
            {{ t('account.mfa.passkeyDismissed') }}
          </AppAlert>
          <AppAlert v-if="mfa.labelMissing.value" variant="error">
            {{ t('account.mfa.labelMissing') }}
          </AppAlert>
          <AppText v-if="mfa.loading.value && mfa.methods.value.length === 0">
            {{ t('common.states.loading') }}
          </AppText>
          <AppText v-else-if="mfa.methods.value.length === 0">{{ t('account.mfa.empty') }}</AppText>
          <MfaMethodList
            v-else
            :methods="mfa.methods.value"
            :busy="mfa.loading.value"
            @remove="(methodId) => mfa.remove(methodId)"
          />
          <!--
            Only an account with a confirmed method holds codes to count; for any
            other a zero would be a warning about something it never had. `null`
            is "not read yet", which is not zero and shows nothing.
          -->
          <template v-if="hasConfirmedMethod && mfa.recoveryCodesRemaining.value !== null">
            <AppText>
              {{ t('account.mfa.recoveryRemaining', { count: mfa.recoveryCodesRemaining.value }) }}
            </AppText>
            <AppAlert v-if="recoveryCodesLow" variant="warning" data-test="recovery-codes-low">
              {{
                mfa.recoveryCodesRemaining.value === 0
                  ? t('account.mfa.recoveryNone')
                  : t('account.mfa.recoveryLow', { count: mfa.recoveryCodesRemaining.value })
              }}
            </AppAlert>
          </template>
          <AppStack as="form" gap="md" @submit.prevent="startTotp">
            <FormField id="totp-label" :label="t('account.mfa.addTotpLabel')">
              <AppInput id="totp-label" v-model="totpLabel" :disabled="mfa.loading.value" />
            </FormField>
            <AppButton type="submit" variant="secondary" :disabled="mfa.loading.value">
              {{ t('account.mfa.addTotp') }}
            </AppButton>
          </AppStack>
          <AppStack v-if="passkeysAvailable" as="form" gap="md" @submit.prevent="startPasskey">
            <FormField id="passkey-label" :label="t('account.mfa.addPasskeyLabel')">
              <AppInput id="passkey-label" v-model="passkeyLabel" :disabled="mfa.loading.value" />
            </FormField>
            <AppButton type="submit" variant="secondary" :disabled="mfa.loading.value">
              {{ t('account.mfa.addPasskey') }}
            </AppButton>
          </AppStack>
          <AppButton
            v-if="hasConfirmedMethod"
            variant="ghost"
            :disabled="mfa.loading.value"
            @click="mfa.beginRegeneration"
          >
            {{ t('account.mfa.regenerate') }}
          </AppButton>
        </template>
      </AppStack>
    </AppCard>
  </AppStack>
</template>
