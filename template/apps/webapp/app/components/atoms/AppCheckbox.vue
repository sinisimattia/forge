<script setup lang="ts">
interface Props {
  disabled?: boolean;
  id?: string;
  label?: string;
}

withDefaults(defineProps<Props>(), {
  disabled: false,
  id: undefined,
  label: undefined,
});

// See AppInput for why this is `defineModel` and not a prop/emit/handler triple.
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <label
    class="inline-flex items-center gap-2 cursor-pointer"
    :class="{ 'opacity-50 cursor-not-allowed': disabled }"
  >
    <input
      :id="id"
      v-model="model"
      type="checkbox"
      :disabled="disabled"
      :class="[
        'h-4 w-4 rounded border-neutral-300 text-primary-600',
        'focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
        'disabled:cursor-not-allowed',
      ]"
    >
    <span v-if="label" class="text-sm font-medium text-neutral-900">{{ label }}</span>
  </label>
</template>
