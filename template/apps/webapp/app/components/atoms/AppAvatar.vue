<script setup lang="ts">
interface Props {
  initials: string;
  size?: 'sm' | 'md';
}

const props = withDefaults(defineProps<Props>(), {
  size: 'sm',
});

const sizeClasses: Record<string, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
};

const classes = computed(() => [
  'inline-flex items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700',
  sizeClasses[props.size],
]);
</script>

<template>
  <span :class="classes">{{ initials }}</span>
</template>
