<script setup lang="ts">
interface Props {
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  size?: 'hero' | 'xl' | 'lg' | 'md' | 'sm' | 'xs' | 'xxs';
  color?: 'default' | 'primary' | 'muted' | 'error' | 'white';
  colorValue?: string;
}

const props = withDefaults(defineProps<Props>(), {
  as: 'h2',
  size: 'sm',
  color: 'default',
  colorValue: undefined,
});

const sizeClasses: Record<string, string> = {
  hero: 'text-4xl font-bold',
  xl: 'text-3xl font-bold',
  lg: 'text-2xl font-bold',
  md: 'text-xl font-semibold',
  sm: 'text-lg font-semibold',
  xs: 'text-base font-semibold',
  xxs: 'text-sm font-semibold',
};

const colorClasses: Record<string, string> = {
  default: 'text-inherit',
  primary: 'text-primary-600',
  muted: 'text-neutral-500',
  error: 'text-error-600',
  white: 'text-surface',
};

const classes = computed(() => [
  sizeClasses[props.size],
  !props.colorValue && colorClasses[props.color],
]);

const inlineStyle = computed(() =>
  props.colorValue ? { color: props.colorValue } : undefined,
);
</script>

<template>
  <component :is="as" :class="classes" :style="inlineStyle">
    <slot />
  </component>
</template>
