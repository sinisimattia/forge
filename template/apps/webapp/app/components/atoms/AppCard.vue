<script setup lang="ts">
interface Props {
  variant?: 'default' | 'elevated' | 'inset' | 'empty';
  as?: 'div' | 'section' | 'article';
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  as: 'div',
});

const variantClasses: Record<string, string> = {
  default: 'bg-surface border border-neutral-200 rounded-lg',
  elevated: 'bg-surface border border-neutral-200 shadow-sm rounded-lg',
  inset: 'bg-neutral-50 border border-neutral-200 rounded-md',
  empty: 'bg-neutral-50 border border-dashed border-neutral-300 text-center rounded-lg',
};

const classes = computed(() => ['p-5', variantClasses[props.variant]]);
</script>

<template>
  <component :is="as" :class="classes">
    <slot />
  </component>
</template>
