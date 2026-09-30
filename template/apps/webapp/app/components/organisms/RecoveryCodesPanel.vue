<script setup lang="ts">
/**
 * The account's recovery codes, in the clear, for the only time they will be.
 *
 * ## Shown once, and the screen says so before anything else on it
 *
 * The server stores digests. Nobody — not support, not an administrator, not
 * somebody holding a database dump — can read these back afterwards, and there
 * is no endpoint that returns them. A person who closes this panel without
 * saving them has ten codes that exist nowhere, and finds out on the day they
 * lose their phone. So the warning is the first thing in the panel, above the
 * codes, and "Done" is disabled until they say they have kept them.
 *
 * ## Leaving
 *
 * Two ways out, and this component owns one of them. `beforeunload` covers
 * closing or reloading the tab and is registered here. Following a link in the
 * application — the one people actually do — is `onBeforeRouteLeave`, which only
 * works in a route component and warns anywhere else (a story has none), so it
 * is the page's: the panel reports whether the codes are kept through the `saved`
 * model and the page decides. Once they are kept, neither gets in the way.
 *
 * ## Copy and download
 *
 * Both, because a clipboard is not a place to keep anything and a file is. The
 * download is a `Blob` behind an object URL that is revoked a second after the
 * click — not in the same tick, which some browsers start the download after —
 * so the codes are not left reachable at an address for long.
 *
 * ## What it does not do
 *
 * It does not remember. The codes are a prop; `dismiss` is an event; the parent
 * drops them and this component is gone. A "show them again" here would have
 * nothing to show them from.
 */
interface Props {
  /** The batch, exactly as the server returned it. */
  codes: readonly string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  /** The person has kept them. The parent drops the batch. */
  dismiss: [];
}>();

const { t } = useI18n();

/** How long the download's address stays live. */
const REVOKE_AFTER_MS = 1000;

/** Whether the person has said they kept the codes. The page reads it to guard navigation. */
const saved = defineModel<boolean>('saved', { default: false });
const copied = ref(false);
const copyFailed = ref(false);

/** One per line: the format a text editor, a password manager and a printer all take. */
const asText = computed(() => `${props.codes.join('\n')}\n`);

async function copy(): Promise<void> {
  copyFailed.value = false;
  try {
    await navigator.clipboard.writeText(asText.value);
    copied.value = true;
  } catch {
    copied.value = false;
    copyFailed.value = true;
  }
}

function download(): void {
  const url = URL.createObjectURL(new Blob([asText.value], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'recovery-codes.txt';
  link.click();
  // Not synchronously: some browsers start the download after the click handler
  // returns, and an address revoked by then downloads nothing.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * Asks the browser to confirm before the tab is closed or reloaded while the
 * codes are on screen and not yet kept. It is a prompt rather than a guarantee,
 * and the text above the codes is what does the telling; in-app navigation is
 * the page's `onBeforeRouteLeave` in `pages/account/security.vue`.
 */
function warnBeforeLeaving(event: { preventDefault: () => void }): void {
  if (!saved.value) event.preventDefault();
}

onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeLeaving);
});

onUnmounted(() => {
  window.removeEventListener('beforeunload', warnBeforeLeaving);
});
</script>

<template>
  <AppStack gap="md">
    <AppHeading as="h2" size="md">{{ t('account.mfa.recovery.title') }}</AppHeading>
    <AppAlert variant="warning">{{ t('account.mfa.recovery.showOnce') }}</AppAlert>
    <AppText>{{ t('account.mfa.recovery.explain') }}</AppText>
    <ul
      id="recovery-codes"
      class="grid grid-cols-2 gap-2 rounded-md bg-neutral-100 p-4 font-mono text-sm"
    >
      <li v-for="code in codes" :key="code" class="select-all">{{ code }}</li>
    </ul>
    <AppStack direction="row" gap="md" wrap>
      <AppButton variant="secondary" @click="copy">{{ t('account.mfa.recovery.copy') }}</AppButton>
      <AppButton variant="secondary" @click="download">
        {{ t('account.mfa.recovery.download') }}
      </AppButton>
    </AppStack>
    <AppText v-if="copied" color="success">{{ t('account.mfa.recovery.copied') }}</AppText>
    <AppText v-if="copyFailed" color="error">{{ t('account.mfa.recovery.copyFailed') }}</AppText>
    <AppCheckbox
      id="recovery-saved"
      v-model="saved"
      :label="t('account.mfa.recovery.saved')"
    />
    <AppButton :disabled="!saved" @click="emit('dismiss')">
      {{ t('account.mfa.recovery.done') }}
    </AppButton>
  </AppStack>
</template>
