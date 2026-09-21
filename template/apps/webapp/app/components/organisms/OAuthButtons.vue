<script setup lang="ts">
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { PROVIDER_LABEL_KEYS } from '~/utils/providerLabels';

/**
 * One button per federated provider this deployment configured.
 *
 * Presentational, in the way `IdentityList` is: reading the list is
 * `useOAuthProviders`', and where a chosen provider actually leads — a
 * top-level navigation to the backend's own authorization endpoint — is the
 * page's, because only a page can hold the `?redirect=` this component was
 * never handed.
 *
 * ## Absent, not empty — ADR-0008 (the reason the root is a bare `v-for`)
 *
 * An unconfigured provider is not a button that fails when someone presses
 * it, and this component's empty case follows the same rule one level up: no
 * providers configured means **nothing renders at all** — not a heading with
 * an empty list beneath it, not a divider with nothing below it. That rules
 * out the obvious `<div v-if="providers.length"><AppButton v-for=".." /></div>`
 * shape: a one-armed `v-if` compiles to a comment placeholder for its false
 * branch (`<!--v-if-->`), which is a real DOM node and not "nothing". A
 * `v-for` over an empty array is: it produces zero vnodes and, at the
 * template's own root with no wrapping element, zero DOM nodes. `OAuthButtons.spec.ts`
 * pins `wrapper.html()` to the literal empty string, which is exactly the
 * distinction this comment is protecting: a version of this file that grew
 * a wrapping element around the `v-for` "for spacing" would still fail that
 * one assertion, silently, back to the pattern ADR-0008 forbids.
 */
interface Props {
  /** The providers this deployment configured, in the order to show them. */
  providers: readonly AuthProvider[];
  /** Whether a request is in flight; every button is disabled while it is. */
  busy?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  busy: false,
});

const emit = defineEmits<{
  /** Begin signing in with that provider. The page navigates; this does not. */
  choose: [provider: AuthProvider];
}>();

const { t } = useI18n();

/**
 * `providers`, minus a `PASSWORD` that should never have arrived.
 *
 * The backend's `/auth/oauth/providers` never lists it — it is not a
 * federated provider, it is the one way in this shared `Record` exists to
 * label for `IdentityList`'s sake — but this filters it out explicitly
 * rather than trusting the caller, the same way a button rendered from a raw
 * enum value would be the failure this component exists to prevent.
 */
const federated = computed(() => props.providers.filter((provider) => (
  provider !== AuthProvider.PASSWORD
)));
</script>

<template>
  <template v-for="provider in federated" :key="provider">
    <AppButton
      type="button"
      variant="secondary"
      :disabled="busy"
      @click="emit('choose', provider)"
    >
      {{ t('auth.oauth.continueWith', { provider: t(PROVIDER_LABEL_KEYS[provider]) }) }}
    </AppButton>
  </template>
</template>
