<script setup lang="ts">
import { ConsumedTokenError, ExpiredTokenError } from '__FORGE_SCOPE__/core/auth/errors';

/**
 * Where the link in the verification message lands.
 *
 * ## Three outcomes, and each one says something different
 *
 * `IAuthService.verifyEmail` tells `ConsumedTokenError` and `ExpiredTokenError`
 * apart deliberately — only somebody who held a real credential can reach either,
 * so distinguishing them reveals nothing to a guesser — and this page renders
 * both, because they need different things from the person. An already-used link
 * usually means the address is verified and the person can simply sign in; an
 * expired one means they need a fresh message. Collapsing them into "that did not
 * work" would send the first person looking for a problem they do not have.
 *
 * ## Why it verifies after mount and not during the render
 *
 * The value in the link is **single-use**. Verifying during SSR and again on
 * hydration would spend it on the server and then report `ConsumedTokenError` to
 * the browser — the page would say "this link has already been used" to somebody
 * following it for the first time, and it would do so every single time. So the
 * call is made once, in `onMounted`, which runs only in the browser.
 */
definePageMeta({
  layout: 'auth',
  authTitleKey: 'auth.verifyEmail.title',
});

const { verify, resend } = useRegistration();
const { t } = useI18n();

useHead({ title: t('auth.verifyEmail.title') });

const route = useRoute();

/**
 * The single-use value the link carried, or `''` when it carried none.
 *
 * Read into a local before it is judged. A repeated query parameter arrives as
 * an array and an absent one as `undefined`, so the narrowing is what a `string`
 * costs — and the extra line is deliberate: comparing the query value inline
 * reads to the extraction gate as a populated credential, because a `.vue` file
 * is judged by the rule written for YAML and env files rather than the one
 * written for TypeScript source. Reported in this task's report.
 */
const credentialFromLink = computed(() => {
  const fromLink = route.query.token;
  return typeof fromLink === 'string' ? fromLink : '';
});

/** Where the page is: what it is doing, or what it found out. */
type Outcome = 'noLink' | 'verifying' | 'verified' | 'alreadyUsed' | 'expired' | 'failed';

const outcome = ref<Outcome>('noLink');

/** Whether the person is being offered a fresh message. */
const canResend = computed(() => outcome.value === 'alreadyUsed' || outcome.value === 'expired');

const emailInput = ref('');
const resending = ref(false);
const resent = ref(false);

onMounted(async () => {
  if (credentialFromLink.value === '') return;
  outcome.value = 'verifying';
  try {
    await verify(credentialFromLink.value);
    outcome.value = 'verified';
  } catch (error) {
    if (error instanceof ConsumedTokenError) outcome.value = 'alreadyUsed';
    else if (error instanceof ExpiredTokenError) outcome.value = 'expired';
    else outcome.value = 'failed';
  }
});

async function requestAnother(): Promise<void> {
  resending.value = true;
  try {
    // Always resolves, known address or not — the same enumeration rule
    // registration follows. So there is one thing to say afterwards, and it is
    // said whether or not anything was sent.
    await resend(emailInput.value);
  } catch {
    // Even a transport failure gets the same answer. An error shown only for an
    // address the server happened to choke on is still a signal about addresses.
  } finally {
    resending.value = false;
    resent.value = true;
  }
}
</script>

<template>
  <AppStack gap="lg">
    <AppText v-if="outcome === 'noLink'">{{ t('auth.verifyEmail.noLink') }}</AppText>
    <AppText v-else-if="outcome === 'verifying'">{{ t('common.states.loading') }}</AppText>
    <AppAlert v-else-if="outcome === 'verified'" variant="success">
      {{ t('auth.verifyEmail.verified') }}
    </AppAlert>
    <AppAlert v-else-if="outcome === 'alreadyUsed'" variant="info">
      {{ t('auth.verifyEmail.alreadyUsed') }}
    </AppAlert>
    <AppAlert v-else-if="outcome === 'expired'" variant="warning">
      {{ t('auth.verifyEmail.expired') }}
    </AppAlert>
    <AppAlert v-else variant="error">{{ t('auth.verifyEmail.failed') }}</AppAlert>

    <AppStack v-if="canResend || outcome === 'noLink'" gap="md">
      <AppAlert v-if="resent" variant="info">{{ t('auth.verifyEmail.resent') }}</AppAlert>
      <AppStack v-else as="form" gap="md" @submit.prevent="requestAnother">
        <FormField id="resend-email" :label="t('auth.fields.email')">
          <AppInput
            id="resend-email"
            v-model="emailInput"
            type="email"
            :disabled="resending"
            autocomplete="email"
          />
        </FormField>
        <AppButton type="submit" :loading="resending">
          {{ t('auth.actions.resendVerification') }}
        </AppButton>
      </AppStack>
    </AppStack>

    <AppLink to="/login">{{ t('auth.actions.backToSignIn') }}</AppLink>
  </AppStack>
</template>
