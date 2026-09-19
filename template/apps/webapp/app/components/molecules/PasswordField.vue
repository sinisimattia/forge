<script setup lang="ts">
import {
  DEFAULT_PASSWORD_POLICY,
  evaluatePassword,
} from '__FORGE_SCOPE__/core/identities/policies';
import type { PasswordPolicyViolation } from '__FORGE_SCOPE__/core/identities/types';

interface Props {
  /** The visible label. Always present: a field a screen reader cannot name is unusable. */
  label: string;
  /** The `id` the label points at, and the input carries. */
  id: string;
  disabled?: boolean;
  /**
   * What the browser should offer here — `current-password` when proving an
   * existing secret, `new-password` when choosing one. It is passed through
   * explicitly rather than left to attribute fall-through, which would land it
   * on this molecule's wrapper instead of on the input.
   */
  autocomplete?: 'current-password' | 'new-password';
  /**
   * Whether to judge what is typed against the policy as it is typed.
   *
   * **Off by default, and the default is the interesting half.** On a sign-in
   * form the secret being typed is one the person already has: judging it would
   * tell somebody whose account predates a policy change that their own working
   * password is invalid, and would publish the current rule to anybody who typed
   * three characters into a form they cannot pass anyway. It is switched on only
   * where a secret is being *chosen*.
   */
  checkPolicy?: boolean;
  /** A message from the server, shown under the field. */
  error?: string;
  /**
   * Violations the **server** reported, on top of whatever is visible from here.
   *
   * It is the only way `BREACHED` can ever be shown: whether a secret is already
   * public is a lookup against a registry, not a judgement anybody holding the
   * secret and the policy can make, so `evaluatePassword` cannot and does not
   * return it. A field with no way in for a server-reported violation would show
   * a person an empty list beside a refusal.
   */
  reportedViolations?: readonly PasswordPolicyViolation[];
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  autocomplete: 'current-password',
  checkPolicy: false,
  error: '',
  reportedViolations: () => [],
});

const model = defineModel<string>({ default: '' });

const { t } = useI18n();

const revealed = ref(false);

/**
 * One translation key per way a secret can fall short.
 *
 * A `Record` over core's own union and not a template-built key, so that a
 * member added to `PasswordPolicyViolation` is a compile error here rather than
 * a violation that renders as a missing string. `BREACHED` is listed although
 * `evaluatePassword` never returns it: it reaches this component from the
 * server, inside a `WeakPasswordError`, and a field that could not name it would
 * show a person an empty list and no way forward.
 */
const VIOLATION_MESSAGE_KEYS: Record<PasswordPolicyViolation, string> = {
  TOO_SHORT: 'auth.passwordRules.tooShort',
  TOO_LONG: 'auth.passwordRules.tooLong',
  NEEDS_MIXED_CASE: 'auth.passwordRules.needsMixedCase',
  NEEDS_DIGIT: 'auth.passwordRules.needsDigit',
  BREACHED: 'auth.passwordRules.breached',
};

/**
 * Every way what is typed falls short, as core judges it.
 *
 * **The rule is not restated here, and must not be.** `evaluatePassword` and
 * `DEFAULT_PASSWORD_POLICY` are the same function and the same constant the
 * server applies, imported rather than approximated. A second copy in the UI is
 * exactly what the shared policy exists to prevent, and it drifts silently: the
 * server refuses and the form says the secret was fine.
 *
 * Nothing is shown for an empty field — a person who has typed nothing has not
 * yet failed at anything.
 */
const violations = computed<PasswordPolicyViolation[]>(() => {
  const judged = !props.checkPolicy || model.value === ''
    ? []
    : evaluatePassword(model.value, DEFAULT_PASSWORD_POLICY);
  // De-duplicated, because the server and this side judge the same secret
  // against the same policy and will usually agree: a secret refused as
  // `TOO_SHORT` would otherwise be listed twice, which reads as two problems.
  return [...new Set([...judged, ...props.reportedViolations])];
});

/**
 * The policy's own numbers, passed to every message.
 *
 * Both are sent for every violation rather than one per key: `vue-i18n` ignores
 * an interpolation a message does not use, and a lookup that chose the right
 * parameter per key would be a third place the policy's shape is written down.
 */
const policyBounds = computed(() => ({
  minimum: DEFAULT_PASSWORD_POLICY.minLength,
  maximum: DEFAULT_PASSWORD_POLICY.maxLength,
}));

const toggleLabel = computed(
  () => (revealed.value ? t('auth.actions.hidePassword') : t('auth.actions.showPassword')),
);

function toggle(): void {
  revealed.value = !revealed.value;
}
</script>

<template>
  <AppStack gap="none">
    <AppText
      as="label"
      color="default"
      weight="medium"
      :for="id"
      class="mb-1 block"
    >
      {{ label }}
    </AppText>
    <!-- bare div: a positioning shim only. The reveal control is absolutely
         positioned over the right-hand end of the input, and no layout atom
         models "one element overlaid on another". -->
    <div class="relative">
      <AppInput
        :id="id"
        v-model="model"
        :type="revealed ? 'text' : 'password'"
        :disabled="disabled"
        :has-error="error !== '' || violations.length > 0"
        :autocomplete="autocomplete"
        class="pr-16"
      />
      <AppButton
        variant="unstyled"
        class="absolute inset-y-0 right-0 px-3 text-sm font-medium text-primary-600
          hover:text-primary-700"
        :disabled="disabled"
        @click="toggle"
      >
        {{ toggleLabel }}
      </AppButton>
    </div>
    <AppText v-if="error" color="error" class="mt-1">{{ error }}</AppText>
    <AppStack v-if="violations.length > 0" gap="none" class="mt-1">
      <AppText
        v-for="code in violations"
        :key="code"
        color="error"
        size="xs"
      >
        {{ t(VIOLATION_MESSAGE_KEYS[code], policyBounds) }}
      </AppText>
    </AppStack>
  </AppStack>
</template>
