<script setup lang="ts">
interface Props {
  src: string;
  alt: string;
  size?: 'sm' | 'md' | 'lg' | 'auto';
  rounded?: 'none' | 'md' | 'lg' | 'full';
  fit?: 'contain' | 'cover' | 'fill';
  maxWidth?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'auto',
  rounded: 'none',
  fit: 'cover',
  maxWidth: undefined,
});

const sizeClasses: Record<string, string> = {
  sm: 'h-8 w-8',
  md: 'h-16 w-16',
  lg: 'h-48 w-48',
  auto: '',
};

const roundedClasses: Record<string, string> = {
  none: '',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

const fitClasses: Record<string, string> = {
  contain: 'object-contain',
  cover: 'object-cover',
  fill: 'object-fill',
};

const classes = computed(() => [
  sizeClasses[props.size],
  roundedClasses[props.rounded],
  fitClasses[props.fit],
]);

const inlineStyle = computed(() =>
  props.maxWidth ? { maxWidth: props.maxWidth } : undefined,
);
</script>

<template>
  <img :src="src" :alt="alt" :class="classes" :style="inlineStyle" >
</template>
