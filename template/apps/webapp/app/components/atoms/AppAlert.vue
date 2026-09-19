<script setup lang="ts">
interface Props {
  variant: 'error' | 'warning' | 'success' | 'info' | 'primary';
  density?: 'compact' | 'default' | 'spacious';
}

const props = withDefaults(defineProps<Props>(), {
  density: 'default',
});

const variantClasses: Record<string, string> = {
  error: 'bg-error-50 text-error-700 border-error-200',
  warning: 'bg-warning-50 text-warning-700 border-warning-200',
  success: 'bg-success-50 text-success-700 border-success-200',
  info: 'bg-info-50 text-info-700 border-info-200',
  primary: 'bg-primary-50 text-primary-800 border-primary-200',
};

const densityClasses: Record<string, string> = {
  compact: 'rounded-md p-3 text-sm',
  default: 'rounded-md border px-4 py-3 text-sm',
  spacious: 'rounded-lg border p-4 text-sm',
};

const classes = computed(() => [
  variantClasses[props.variant],
  densityClasses[props.density],
]);
</script>

<template>
  <div :class="classes" role="alert">
    <slot />
  </div>
</template>
