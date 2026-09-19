<script setup lang="ts">
interface TabDefinition {
  key: string;
  label: string;
  hidden?: boolean;
  badge?: number;
}

interface Props {
  tabs: TabDefinition[];
  modelValue: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const visibleTabs = computed(() => props.tabs.filter((tab) => !tab.hidden));
</script>

<template>
  <AppStack
    direction="row"
    gap="none"
    role="tablist"
    class="border-b border-neutral-200 overflow-x-auto"
  >
    <AppTab
      v-for="tab in visibleTabs"
      :key="tab.key"
      :active="props.modelValue === tab.key"
      :badge="tab.badge"
      @click="emit('update:modelValue', tab.key)"
    >
      {{ tab.label }}
    </AppTab>
  </AppStack>
</template>
