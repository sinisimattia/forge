<script setup lang="ts">
interface Props {
  direction?: 'horizontal' | 'vertical';
  variant?: 'solid' | 'dashed';
  color?: 'default' | 'light';
  colorValue?: string;
}

const props = withDefaults(defineProps<Props>(), {
  direction: 'horizontal',
  variant: 'solid',
  color: 'default',
  colorValue: undefined,
});

const colorClasses: Record<string, string> = {
  default: 'border-neutral-200',
  light: 'border-neutral-300',
};

const horizontalClasses = computed(() => [
  'border-t',
  !props.colorValue && colorClasses[props.color],
  props.variant === 'dashed' && 'border-dashed',
]);

const verticalClasses = computed(() => [
  'border-l self-stretch',
  !props.colorValue && colorClasses[props.color],
  props.variant === 'dashed' && 'border-dashed',
]);

const inlineStyle = computed(() =>
  props.colorValue ? { borderColor: props.colorValue } : undefined,
);
</script>

<template>
  <hr v-if="direction === 'horizontal'" :class="horizontalClasses" :style="inlineStyle" >
  <div v-else role="separator" :class="verticalClasses" :style="inlineStyle" />
</template>
