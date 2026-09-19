<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';

interface Props {
  to?: string | RouteLocationRaw;
  href?: string;
  variant?: 'inline' | 'nav' | 'sidebar' | 'button' | 'button-outline' | 'block';
  size?: 'sm' | 'md';
  target?: '_blank' | '_self';
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  to: undefined,
  href: undefined,
  variant: 'inline',
  size: 'md',
  target: '_self',
  disabled: false,
});

const variantClasses: Record<string, string> = {
  inline: 'font-medium text-primary-600 hover:text-primary-500',
  nav: 'text-sm text-neutral-600 hover:text-neutral-900',
  sidebar: 'block rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100',
  button:
    'inline-flex items-center rounded-md bg-primary-600 font-medium text-surface transition-colors hover:bg-primary-700',
  'button-outline':
    'inline-flex items-center rounded-md bg-surface font-medium text-neutral-700 ring-1 ring-neutral-300 transition-colors hover:bg-neutral-50',
  block:
    'block rounded-lg border border-neutral-200 bg-surface transition-shadow hover:shadow-md',
};

const sizeClasses: Record<string, Record<string, string>> = {
  button: { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' },
  'button-outline': { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' },
};

const classes = computed(() => {
  const base = [variantClasses[props.variant]];
  const variantSizes = sizeClasses[props.variant];
  if (variantSizes) {
    base.push(variantSizes[props.size]);
  }
  if (props.disabled) {
    base.push('pointer-events-none opacity-50');
  }
  return base;
});

const isExternal = computed(() => !!props.href);
</script>

<template>
  <a
    v-if="isExternal"
    :href="href"
    :target="target"
    :class="classes"
    :rel="target === '_blank' ? 'noopener noreferrer' : undefined"
  >
    <slot />
  </a>
  <NuxtLink v-else :to="to ?? '/'" :class="classes">
    <slot />
  </NuxtLink>
</template>
