<script setup lang="ts">
interface Props {
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'ghost' | 'unstyled';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'button',
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
});

const sizeClasses: Record<string, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

const variantClasses: Record<string, string> = {
  primary: 'bg-primary-600 text-surface hover:bg-primary-700 focus:ring-primary-500',
  secondary:
    'bg-surface text-neutral-700 border border-neutral-300 hover:bg-neutral-50 focus:ring-primary-500',
  ghost: 'bg-transparent text-neutral-700 hover:bg-neutral-100 focus:ring-primary-500',
};

const classes = computed(() => {
  // The unstyled variant drops all visual base classes so callers can build
  // bare clickable regions (menu triggers, disclosure rows) while keeping a
  // real <button> element. Layout/appearance is supplied by the caller.
  if (props.variant === 'unstyled') {
    return ['focus:outline-none disabled:cursor-not-allowed disabled:opacity-50'];
  }
  return [
    'inline-flex items-center justify-center rounded-md font-medium transition-colors',
    'focus:outline-none focus:ring-2 focus:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    sizeClasses[props.size],
    variantClasses[props.variant],
  ];
});
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading">
    <svg
      v-if="loading"
      class="-ml-1 mr-2 h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z
           m2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
    <slot />
  </button>
</template>
