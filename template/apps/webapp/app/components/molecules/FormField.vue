<script setup lang="ts">
interface Props {
  label: string;
  error?: string;
  required?: boolean;
  id?: string;
}

withDefaults(defineProps<Props>(), {
  error: '',
  required: false,
  id: undefined,
});
</script>

<template>
  <AppStack gap="none">
    <AppText
      v-if="label"
      as="label"
      color="default"
      weight="medium"
      :for="id"
      class="mb-1 block"
    >
      {{ label }}
      <AppText v-if="required" as="span" color="error">*</AppText>
    </AppText>
    <slot />
    <AppText v-if="error" color="error" class="mt-1">{{ error }}</AppText>
  </AppStack>
</template>
