<script setup lang="ts">
interface Props {
  modelValue?: string;
  options: { value: string; label: string; description?: string }[];
  name: string;
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  modelValue: '',
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onChange(value: string) {
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <label
      v-for="opt in options"
      :key="opt.value"
      class="flex items-start gap-2 cursor-pointer"
      :class="{ 'opacity-50 cursor-not-allowed': disabled }"
    >
      <input
        type="radio"
        :name="name"
        :value="opt.value"
        :checked="modelValue === opt.value"
        :disabled="disabled"
        class="mt-0.5 h-4 w-4 border-neutral-300 text-primary-600 focus:ring-primary-500"
        @change="onChange(opt.value)"
      >
      <span class="text-sm">
        <span class="font-medium text-neutral-900">{{ opt.label }}</span>
        <span v-if="opt.description" class="block text-neutral-500">{{
          opt.description
        }}</span>
      </span>
    </label>
  </div>
</template>
