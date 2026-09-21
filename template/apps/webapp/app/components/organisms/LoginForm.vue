<script setup lang="ts">
import { AuthenticationStatus } from '__FORGE_SCOPE__/core/auth/enums';
import { assertNever, normalizeEmail } from '__FORGE_SCOPE__/core/shared/policies';

/**
 * Proving who you are.
 *
 * ## One message, for every way this can fail (DEC/D7)
 *
 * There is a single failure string, it is fixed, and it is shown for a refusal,
 * for a network fault and for anything else. That is not laziness about error
 * handling — it is the client half of the property the backend spends real
 * effort on: sign-in answers identically whether the address is unknown, the
 * secret is wrong, the account is suspended, unverified or deleted, so that
 * nobody can test an address for existence one attempt at a time.
 *
 * **That property is undone as easily by a helpful message as by a different
 * status code.** A screen that said "no account with that address" for one
 * refusal and "incorrect password" for another would republish, in prose, exactly
 * what the backend refused to put in a status line — and it would look like an
 * improvement while doing it. `LoginForm.spec.ts` drives three distinct failures
 * and asserts the rendered text is character-for-character identical; that
 * assertion exists to fail the day somebody improves the copy.
 *
 * ## `UNDISCLOSED` is the real answer, and nothing switches on it
 *
 * `AuthenticationOutcome`'s rejection carries a `reason`, and over the wire it is
 * always `AuthenticationRejectionReason.UNDISCLOSED` — the member that means "this
 * implementation was not told". This component therefore does not read `reason`
 * at all. Reading it and switching would compile, would pass every test that only
 * checks the happy path, and would be a switch over a single value pretending to
 * be a diagnosis.
 *
 * ## Where it does not decide
 *
 * It emits `authenticated` and navigates nowhere. Where a signed-in person goes
 * depends on `?redirect=`, which arrives from whoever wrote the link and has to
 * be judged by `localRedirect` before anything acts on it — that judgement lives
 * on the page, where the query is.
 */
const emit = defineEmits<{
  /** A session now exists. The page decides where the person goes. */
  authenticated: [];
}>();

const { login } = useAuth();
const { t } = useI18n();

const emailInput = ref('');
const secretInput = ref('');
const pending = ref(false);
const failed = ref(false);

async function submit(): Promise<void> {
  pending.value = true;
  failed.value = false;
  try {
    // Core's own normalizer, not a `toLowerCase()` written here: two addresses
    // are the same account when their normal forms are equal, and that is one
    // definition in one place. Its visible effect is on a pasted address with
    // surrounding whitespace, which is otherwise sent as typed.
    const outcome = await login(normalizeEmail(emailInput.value), secretInput.value);
    switch (outcome.status) {
      case AuthenticationStatus.AUTHENTICATED:
        emit('authenticated');
        return;
      case AuthenticationStatus.REJECTED:
        // A refusal. `outcome.reason` is deliberately not read — see above.
        failed.value = true;
        break;
      default:
        // Reachable only from outside the type system. A status member added
        // without a branch here is a compile error, which is the whole point: a
        // future member such as MFA_REQUIRED, rendered as a plain sign-in
        // refusal, would be silent and wrong.
        return assertNever(outcome);
    }
  } catch {
    // A fault rather than a refusal: the backend was unreachable, answered
    // something unparseable, or the store found no credential beside a
    // successful outcome. Same flag, same string, on purpose.
    failed.value = true;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AppStack as="form" gap="md" @submit.prevent="submit">
    <AppAlert v-if="failed" variant="error">{{ t('auth.signIn.failed') }}</AppAlert>
    <FormField id="sign-in-email" :label="t('auth.fields.email')">
      <AppInput
        id="sign-in-email"
        v-model="emailInput"
        type="email"
        :disabled="pending"
        autocomplete="username"
      />
    </FormField>
    <PasswordField
      id="sign-in-secret"
      v-model="secretInput"
      :label="t('auth.fields.password')"
      :disabled="pending"
      autocomplete="current-password"
    />
    <AppButton type="submit" :loading="pending">{{ t('auth.actions.signIn') }}</AppButton>
  </AppStack>
</template>
