<script setup lang="ts">
interface Props {
  active?: boolean;
  disabled?: boolean;
  badge?: number;
}

const props = withDefaults(defineProps<Props>(), {
  active: false,
  disabled: false,
  badge: undefined,
});

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button
    role="tab"
    type="button"
    :aria-selected="props.active"
    :disabled="props.disabled"
    :class="[
      'px-4 py-3 text-sm font-medium whitespace-nowrap',
      'border-b-2 transition-colors focus:outline-none',
      props.active
        ? 'border-primary-600 text-primary-600'
        : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300',
      props.disabled && 'opacity-50 cursor-not-allowed',
    ]"
    @click="$emit('click')"
  >
    <slot />
    <span
      v-if="props.badge !== undefined && props.badge > 0"
      :class="[
        'ml-1.5 inline-flex items-center justify-center rounded-full',
        'bg-primary-100 text-primary-700 px-1.5 py-0.5 text-xs font-medium',
      ]"
    >
      {{ props.badge }}
    </span>
  </button>
</template>
