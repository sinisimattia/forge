<script setup lang="ts">
interface Props {
  backgroundColor?: string;
  borderColor?: string;
  as?: 'div' | 'section' | 'article';
}

const props = withDefaults(defineProps<Props>(), {
  backgroundColor: undefined,
  borderColor: undefined,
  as: 'div',
});

const inlineStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.backgroundColor) style.backgroundColor = props.backgroundColor;
  if (props.borderColor) style.borderColor = props.borderColor;
  return Object.keys(style).length > 0 ? style : undefined;
});
</script>

<template>
  <component :is="as" :style="inlineStyle">
    <slot />
  </component>
</template>
