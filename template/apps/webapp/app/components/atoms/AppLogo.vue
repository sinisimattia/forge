<script setup lang="ts">
type LogoSize = 'inherit' | 'small' | 'regular' | 'large' | 'huge';

withDefaults(
  defineProps<{
    to?: string;
    size?: LogoSize;
  }>(),
  {
    size: 'inherit',
    to: '/',
  },
);

const sizeClass: Record<LogoSize, string> = {
  inherit: '',
  small: 'text-base',
  regular: 'text-xl',
  large: 'text-3xl',
  huge: 'text-9xl',
};

const config = useRuntimeConfig();
</script>

<template>
  <NuxtLink :to="to ?? '/'" class="app-logo text-primary-600" :class="sizeClass[size]">
    {{ config.public.appName.toUpperCase() }}
  </NuxtLink>
</template>

<style lang="scss" scoped>
.app-logo {
  font-family: $font-family-logo;
}
</style>
