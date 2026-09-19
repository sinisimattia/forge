<script setup lang="ts">
interface Props {
  as?: 'p' | 'span' | 'label' | 'small' | 'strong';
  size?: 'xs' | 'sm' | 'base' | 'lg';
  color?:
    | 'default'
    | 'muted'
    | 'secondary'
    | 'placeholder'
    | 'primary'
    | 'error'
    | 'success'
    | 'warning'
    | 'info'
    | 'white';
  colorValue?: string;
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  uppercase?: boolean;
  for?: string;
}

const props = withDefaults(defineProps<Props>(), {
  as: 'p',
  size: 'sm',
  color: 'secondary',
  colorValue: undefined,
  weight: undefined,
  uppercase: false,
  for: undefined,
});

const sizeClasses: Record<string, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
};

const colorClasses: Record<string, string> = {
  default: 'text-neutral-900',
  secondary: 'text-neutral-600',
  muted: 'text-neutral-500',
  placeholder: 'text-neutral-400',
  primary: 'text-primary-600',
  error: 'text-error-600',
  success: 'text-success-600',
  warning: 'text-warning-700',
  info: 'text-info-700',
  white: 'text-surface',
};

const weightClasses: Record<string, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
};

const derivedWeight = computed(() => {
  if (props.weight) return props.weight;
  if (props.as === 'label') return 'medium';
  if (props.as === 'strong') return 'semibold';
  return 'normal';
});

const classes = computed(() => [
  sizeClasses[props.size],
  !props.colorValue && colorClasses[props.color],
  weightClasses[derivedWeight.value],
  props.uppercase && 'uppercase tracking-wider',
]);

const inlineStyle = computed(() =>
  props.colorValue ? { color: props.colorValue } : undefined,
);
</script>

<template>
  <component
    :is="as"
    :class="classes"
    :style="inlineStyle"
    :for="as === 'label' ? $props.for : undefined"
  >
    <slot />
  </component>
</template>
