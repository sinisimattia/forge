<script setup lang="ts">
interface Props {
  percentage: number;
  color?: 'primary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  color: 'primary',
  size: 'md',
  showLabel: false,
});

const colorClasses: Record<string, string> = {
  primary: 'bg-primary-600',
  success: 'bg-success-600',
  warning: 'bg-warning-500',
  error: 'bg-error-600',
};

const sizeClasses: Record<string, string> = {
  sm: 'h-1.5',
  md: 'h-2.5',
};

const fillWidth = computed(() => Math.min(props.percentage, 100));
const displayPercentage = computed(() => Math.round(props.percentage));
</script>

<template>
  <div class="w-full">
    <div
      :class="['w-full overflow-hidden rounded-full bg-neutral-200', sizeClasses[size]]"
    >
      <div
        :class="[
          'rounded-full transition-all duration-300',
          colorClasses[color],
          sizeClasses[size],
        ]"
        :style="{ width: `${fillWidth}%` }"
      />
    </div>
    <p v-if="showLabel" class="mt-1 text-xs text-neutral-600">{{ displayPercentage }}%</p>
  </div>
</template>
