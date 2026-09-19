<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    variant?: 'default' | 'muted' | 'primary' | 'dark';
    size?: 'sm' | 'md' | 'lg' | 'xl';
    align?: 'left' | 'center' | 'right';
  }>(),
  {
    variant: 'default',
    size: 'lg',
    align: 'left',
  },
);

const variantClasses: Record<string, string> = {
  default: 'bg-surface',
  muted: 'bg-neutral-50',
  primary: 'bg-primary-600 text-surface',
  dark: 'bg-neutral-900 text-surface',
};

const sizeClasses: Record<string, string> = {
  sm: 'py-12',
  md: 'py-16',
  lg: 'py-24',
  xl: 'py-32',
};

const alignClasses: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};
</script>

<template>
  <section
    :class="[
      variantClasses[props.variant],
      sizeClasses[props.size],
      alignClasses[props.align],
    ]"
  >
    <slot />
  </section>
</template>
