<script setup lang="ts">
import type { IconName } from '~/types';

interface Props {
  name: IconName;
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
});

interface IconDefinition {
  viewBox: string;
  mode: 'fill' | 'stroke';
  paths: string[];
}

const icons: Record<IconName, IconDefinition> = {
  'chevron-down': {
    viewBox: '0 0 20 20',
    mode: 'fill',
    paths: [
      'M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z',
    ],
  },
  check: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    paths: ['M5 13l4 4L19 7'],
  },
  card: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    paths: [
      'M2.25 8.25h19.5M4.5 5.25h15a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25v-9A2.25 2.25 0 0 1 4.5 5.25ZM6 15.75h3',
    ],
  },
  warning: {
    viewBox: '0 0 24 24',
    mode: 'stroke',
    paths: [
      'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
    ],
  },
};

const sizeClasses: Record<string, string> = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const definition = computed(() => icons[props.name]);
const classes = computed(() => sizeClasses[props.size]);
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="definition.viewBox"
    :fill="definition.mode === 'fill' ? 'currentColor' : 'none'"
    :stroke="definition.mode === 'stroke' ? 'currentColor' : undefined"
    :stroke-width="definition.mode === 'stroke' ? 2 : undefined"
    :class="classes"
    aria-hidden="true"
  >
    <path
      v-for="(pathData, index) in definition.paths"
      :key="index"
      :d="pathData"
      :fill-rule="definition.mode === 'fill' ? 'evenodd' : undefined"
      :clip-rule="definition.mode === 'fill' ? 'evenodd' : undefined"
      :stroke-linecap="definition.mode === 'stroke' ? 'round' : undefined"
      :stroke-linejoin="definition.mode === 'stroke' ? 'round' : undefined"
    />
  </svg>
</template>
