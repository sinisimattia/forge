<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

const { variant = 'primary', disabled = false } = defineProps<Props>();

const classes = computed(() => ({
  'bg-slate-900 text-white hover:bg-slate-700': variant === 'primary',
  'bg-slate-100 text-slate-900 hover:bg-slate-200': variant === 'secondary',
}));
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    class="rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50"
    :class="classes"
  >
    <slot />
  </button>
</template>
