<script setup lang="ts">
interface Props {
  modelValue?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
  description?: string;
}

withDefaults(defineProps<Props>(), {
  modelValue: false,
  disabled: false,
  id: undefined,
  label: undefined,
  description: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

function toggle(current: boolean) {
  emit('update:modelValue', !current);
}
</script>

<template>
  <label
    class="inline-flex items-center gap-3 cursor-pointer"
    :class="{ 'opacity-50 cursor-not-allowed': disabled }"
  >
    <button
      :id="id"
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :disabled="disabled"
      :class="[
        'relative inline-flex h-6 w-11 shrink-0 rounded-full',
        'border-2 border-transparent transition-colors duration-200 ease-in-out',
        'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
        'disabled:cursor-not-allowed',
        modelValue ? 'bg-primary-600' : 'bg-neutral-200',
      ]"
      @click="toggle(modelValue)"
    >
      <span
        :class="[
          'pointer-events-none inline-block h-5 w-5 rounded-full',
          'bg-surface shadow ring-0 transition duration-200 ease-in-out',
          modelValue ? 'translate-x-5' : 'translate-x-0',
        ]"
      />
    </button>
    <span v-if="label || description" class="flex flex-col">
      <span v-if="label" class="text-sm font-medium text-neutral-900">{{ label }}</span>
      <span v-if="description" class="text-xs text-neutral-500">{{ description }}</span>
    </span>
  </label>
</template>
