<script setup lang="ts">
interface Props {
  type?: 'text' | 'email' | 'password' | 'tel' | 'number' | 'date' | 'datetime-local';
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  id?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
}

withDefaults(defineProps<Props>(), {
  type: 'text',
  placeholder: '',
  disabled: false,
  hasError: false,
  id: undefined,
  min: undefined,
  max: undefined,
  step: undefined,
});

// `defineModel` rather than a `modelValue` prop plus an `update:modelValue` emit and an
// input handler. It is the same public API for every `v-model` caller, it is less code,
// and it keeps DOM typing out of this component entirely. The other three form atoms
// follow the same shape.
const model = defineModel<string>({ default: '' });
</script>

<template>
  <input
    :id="id"
    v-model="model"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :min="min"
    :max="max"
    :step="step"
    :class="[
      'block w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors',
      'placeholder:text-neutral-400',
      'focus:outline-none focus:ring-2 focus:ring-offset-0',
      'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500',
      hasError
        ? 'border-error-300 text-error-900 focus:border-error-500 focus:ring-error-500'
        : 'border-neutral-300 text-neutral-900 focus:border-primary-500 focus:ring-primary-500',
    ]"
  >
</template>
