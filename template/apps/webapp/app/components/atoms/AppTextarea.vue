<script setup lang="ts">
interface Props {
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  id?: string;
  rows?: number;
}

withDefaults(defineProps<Props>(), {
  placeholder: '',
  disabled: false,
  hasError: false,
  id: undefined,
  rows: 4,
});

// See AppInput for why this is `defineModel` and not a prop/emit/handler triple.
const model = defineModel<string>({ default: '' });
</script>

<template>
  <textarea
    :id="id"
    v-model="model"
    :placeholder="placeholder"
    :disabled="disabled"
    :rows="rows"
    :class="[
      'block w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors',
      'placeholder:text-neutral-400',
      'focus:outline-none focus:ring-2 focus:ring-offset-0',
      'disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500',
      hasError
        ? 'border-error-300 text-error-900 focus:border-error-500 focus:ring-error-500'
        : 'border-neutral-300 text-neutral-900 focus:border-primary-500 focus:ring-primary-500',
    ]"
  />
</template>
