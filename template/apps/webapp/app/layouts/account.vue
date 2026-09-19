<script setup lang="ts">
/**
 * The chrome the four account pages share: the header, and a column.
 *
 * There is no navigation between the four here, because there already is one —
 * `UserMenu`, in the header above, lists exactly these routes. A second copy in
 * the page body would be a second list to keep in step with the first.
 */
</script>

<template>
  <AppStack class="min-h-screen bg-neutral-50">
    <AppHeader />
    <AppContainer size="lg" as="main" class="py-10">
      <slot />
    </AppContainer>
  </AppStack>
</template>
