<script setup lang="ts">
interface Props {
  title: string;
  subtitle?: string;
}

withDefaults(defineProps<Props>(), {
  subtitle: '',
});
</script>

<template>
  <AppStack direction="row" align="center" justify="center" class="min-h-screen-offset">
    <AppCard variant="elevated" class="w-full max-w-md">
      <AppHeading as="h1" size="lg">{{ title }}</AppHeading>
      <AppText v-if="subtitle" color="muted" class="mt-2">{{ subtitle }}</AppText>
      <AppStack class="mt-6">
        <slot />
      </AppStack>
      <AppStack v-if="$slots.footer" class="mt-6 text-center">
        <AppText as="span" color="muted">
          <slot name="footer" />
        </AppText>
      </AppStack>
    </AppCard>
  </AppStack>
</template>
