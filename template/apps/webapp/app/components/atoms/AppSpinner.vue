<script setup lang="ts">
interface Props {
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
});

const { t } = useI18n();

const sizeClasses: Record<string, string> = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

const spinnerClass = computed(() => [
  'animate-spin rounded-full border-2 border-current border-t-transparent text-primary-600',
  sizeClasses[props.size],
]);
</script>

<template>
  <div :class="spinnerClass" role="status">
    <span class="sr-only">{{ t('common.states.loading') }}</span>
  </div>
</template>
