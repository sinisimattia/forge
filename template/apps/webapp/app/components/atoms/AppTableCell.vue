<script setup lang="ts">
interface Props {
  header?: boolean;
  align?: 'left' | 'right';
  emphasis?: 'primary' | 'secondary' | 'muted';
  nowrap?: boolean;
  colspan?: number;
}

const props = withDefaults(defineProps<Props>(), {
  header: false,
  align: 'left',
  emphasis: 'secondary',
  nowrap: true,
  colspan: undefined,
});

const alignClasses: Record<string, string> = {
  left: 'text-left',
  right: 'text-right',
};

const headerClasses = computed(() => [
  'px-4 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500',
  alignClasses[props.align],
]);

const cellEmphasisClasses: Record<string, string> = {
  primary: 'text-sm font-medium text-neutral-900',
  secondary: 'text-sm text-neutral-600',
  muted: 'text-sm text-neutral-500',
};

const cellClasses = computed(() => [
  'px-4 py-3',
  cellEmphasisClasses[props.emphasis],
  props.nowrap && 'whitespace-nowrap',
  alignClasses[props.align],
]);
</script>

<template>
  <th v-if="header" :class="headerClasses" :colspan="colspan">
    <slot />
  </th>
  <td v-else :class="cellClasses" :colspan="colspan">
    <slot />
  </td>
</template>
