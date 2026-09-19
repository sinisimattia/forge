<script setup lang="ts">
interface Props {
  direction?: 'row' | 'column';
  gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  as?:
    | 'div'
    | 'section'
    | 'article'
    | 'nav'
    | 'header'
    | 'footer'
    | 'main'
    | 'aside'
    | 'form'
    | 'ul'
    | 'ol'
    | 'li'
    | 'span';
  grow?: boolean;
  shrink?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  direction: 'column',
  gap: 'none',
  align: 'stretch',
  justify: 'start',
  wrap: false,
  as: 'div',
  grow: false,
  shrink: false,
});

const gapClasses: Record<string, string> = {
  none: 'gap-0',
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
  '2xl': 'gap-8',
};

const alignClasses: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
};

const justifyClasses: Record<string, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
};

const classes = computed(() => [
  'flex',
  props.direction === 'row' ? 'flex-row' : 'flex-col',
  gapClasses[props.gap],
  alignClasses[props.align],
  justifyClasses[props.justify],
  props.wrap && 'flex-wrap',
  props.grow && 'flex-1',
  props.shrink && 'shrink-0',
]);
</script>

<template>
  <component :is="as" :class="classes">
    <slot />
  </component>
</template>
