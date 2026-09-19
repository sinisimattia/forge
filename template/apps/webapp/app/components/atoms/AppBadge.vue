<script setup lang="ts">
interface Props {
  color?: 'neutral' | 'success' | 'warning' | 'error' | 'primary' | 'info';
  size?: 'sm' | 'md';
}

const props = withDefaults(defineProps<Props>(), {
  color: 'neutral',
  size: 'md',
});

const colorClasses: Record<string, string> = {
  neutral: 'bg-neutral-100 text-neutral-700',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  error: 'bg-error-100 text-error-700',
  primary: 'bg-primary-100 text-primary-700',
  info: 'bg-info-100 text-info-700',
};

const sizeClasses: Record<string, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

const classes = computed(() => [
  'inline-flex items-center rounded-full font-medium',
  colorClasses[props.color],
  sizeClasses[props.size],
]);
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>
