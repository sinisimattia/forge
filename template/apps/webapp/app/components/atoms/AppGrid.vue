<script setup lang="ts">
interface Props {
  cols?: 1 | 2 | 3 | 4;
  colsSm?: 1 | 2 | 3 | 4;
  colsMd?: 1 | 2 | 3 | 4;
  colsLg?: 1 | 2 | 3 | 4;
  gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  as?: 'div' | 'section' | 'ul' | 'ol';
}

const props = withDefaults(defineProps<Props>(), {
  cols: 1,
  colsSm: undefined,
  colsMd: undefined,
  colsLg: undefined,
  gap: 'lg',
  as: 'div',
});

const colClasses: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

const colSmClasses: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

const colMdClasses: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
};

const colLgClasses: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
};

const gapClasses: Record<string, string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
  '2xl': 'gap-8',
};

const classes = computed(() => [
  'grid',
  colClasses[props.cols],
  props.colsSm && colSmClasses[props.colsSm],
  props.colsMd && colMdClasses[props.colsMd],
  props.colsLg && colLgClasses[props.colsLg],
  gapClasses[props.gap],
]);
</script>

<template>
  <component :is="as" :class="classes">
    <slot />
  </component>
</template>
