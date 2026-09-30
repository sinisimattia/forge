<script setup lang="ts">
import type { TotpEnrollmentBody } from '~/types';

/**
 * The second half of enrolling an authenticator app: the QR to scan, the secret
 * to type when scanning is not possible, and a field for the first code.
 *
 * ## Both, because not everyone can scan
 *
 * A desktop authenticator has no camera to point at a monitor, a second phone
 * may be the one being set up, and a person may not be able to aim at a code at
 * all. The base32 secret is the same value the QR encodes and is shown beside it
 * with its own label, not behind a disclosure — a control that must be found
 * before it can be used is not much of an alternative for those people.
 *
 * ## The QR is an image, not markup
 *
 * `offer.qrSvg` is the server's SVG. It is given to an `<img>` as a data URI
 * rather than injected as HTML: an image cannot run script, so nothing in the
 * markup is trusted to be inert.
 *
 * ## It holds nothing
 *
 * The secret arrives as a prop and is rendered; nothing here copies it into
 * storage or state. `useMfaMethods` owns the one ref it lives in, and drops it on
 * confirmation and on cancel.
 */
interface Props {
  /** What `POST /mfa/totp/enroll` answered with. */
  offer: TotpEnrollmentBody;
  /** Whether a request is in flight. */
  busy?: boolean;
  /** Whether the last code was refused. */
  wrongCode?: boolean;
}

const props = withDefaults(defineProps<Props>(), { busy: false, wrongCode: false });

const emit = defineEmits<{
  /** The person typed the code their authenticator shows. */
  confirm: [code: string];
  /** They gave up; the method stays unconfirmed. */
  cancel: [];
}>();

const { t } = useI18n();

const code = ref('');

const qrSource = computed(
  () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(props.offer.qrSvg)}`,
);

function submit(): void {
  emit('confirm', code.value.trim());
}
</script>

<template>
  <AppStack gap="md">
    <AppHeading as="h2" size="md">{{ t('account.mfa.enroll.title') }}</AppHeading>
    <AppText>{{ t('account.mfa.enroll.scan') }}</AppText>
    <AppImage :src="qrSource" :alt="t('account.mfa.enroll.qrAlt')" size="lg" fit="contain" />
    <AppText>{{ t('account.mfa.enroll.manual') }}</AppText>
    <code
      id="totp-secret"
      class="select-all break-all rounded-md bg-neutral-100 px-3 py-2 font-mono text-sm"
    >{{ offer.secret }}</code>
    <AppAlert v-if="wrongCode" variant="error">{{ t('account.mfa.enroll.wrongCode') }}</AppAlert>
    <AppStack as="form" gap="md" @submit.prevent="submit">
      <FormField id="totp-code" :label="t('account.mfa.enroll.codeLabel')">
        <AppInput
          id="totp-code"
          v-model="code"
          :disabled="busy"
          autocomplete="one-time-code"
        />
      </FormField>
      <AppStack direction="row" gap="md">
        <AppButton type="submit" :loading="busy">{{ t('account.mfa.enroll.confirm') }}</AppButton>
        <AppButton variant="ghost" :disabled="busy" @click="emit('cancel')">
          {{ t('common.actions.cancel') }}
        </AppButton>
      </AppStack>
    </AppStack>
  </AppStack>
</template>
