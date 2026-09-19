<script setup lang="ts">
/**
 * The chrome every page a signed-out visitor meets shares: the header, and one
 * centred card.
 *
 * It wraps `AuthTemplate` so that the five auth pages hold only their own form.
 * The alternative — each page rendering the template itself — is five copies of
 * the same three lines, and five places for them to drift.
 *
 * ## How the title gets here
 *
 * Through route meta, read defensively rather than through a module
 * augmentation. `definePageMeta` accepts arbitrary keys and types their values
 * as `unknown`, so the narrowing below is what a `string` costs — and it is the
 * honest shape: a page that sets nothing gets the generic title rather than
 * `undefined` rendered into the heading.
 */
const route = useRoute();
const { t } = useI18n();

/** The key a page named, or the generic one. */
const titleKey = computed(
  () => (typeof route.meta.authTitleKey === 'string' ? route.meta.authTitleKey : 'auth.title'),
);

/** The key a page named, or nothing — `AuthTemplate` omits a blank subtitle. */
const subtitleKey = computed(
  () => (typeof route.meta.authSubtitleKey === 'string' ? route.meta.authSubtitleKey : ''),
);
</script>

<template>
  <AppStack class="min-h-screen bg-neutral-50">
    <AppHeader />
    <AppContainer size="sm" as="main" class="py-10">
      <AuthTemplate
        :title="t(titleKey)"
        :subtitle="subtitleKey === '' ? '' : t(subtitleKey)"
      >
        <slot />
      </AuthTemplate>
    </AppContainer>
  </AppStack>
</template>
