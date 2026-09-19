<script setup lang="ts">
interface Props {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  as?: 'div' | 'section' | 'main' | 'header' | 'footer' | 'article' | 'nav';
}

const props = withDefaults(defineProps<Props>(), {
  size: 'lg',
  as: 'div',
});

const sizeClasses: Record<string, string> = {
  xs: 'max-w-sm',
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-7xl',
  full: '',
};

const classes = computed(() => [
  'mx-auto w-full px-4 sm:px-6 lg:px-8',
  sizeClasses[props.size],
]);
</script>

<template>
  <component :is="as" :class="classes">
    <slot />
  </component>
</template>
