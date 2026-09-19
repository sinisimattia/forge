<script setup lang="ts">
interface Props {
  interactive?: boolean;
  selected?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  interactive: false,
  selected: false,
});

defineEmits<{
  click: [];
}>();

// An interactive row is reachable and operable from the keyboard: `tabindex` puts it in the
// tab order and the template's Enter/Space handlers activate it, so the click handler is
// never the only way in. It deliberately keeps its implicit `row` role rather than taking
// `role="button"` — that would remove the row from the table's accessibility tree entirely,
// a worse trade than a focusable row. A non-interactive row gets neither and stays out of
// the tab order.
//
// (This note lives here rather than above the `tr`: a comment inside `<template>` is a
// second root node, which turns the component into a fragment — `classes()` comes back
// empty and `trigger` has nothing to target. Its own spec caught that.)
const classes = computed(() => [
  props.interactive && 'cursor-pointer hover:bg-neutral-50',
  props.selected && 'bg-neutral-50',
]);
</script>

<template>
  <tr
    :class="classes"
    :tabindex="interactive ? 0 : undefined"
    @click="$emit('click')"
    @keydown.enter="interactive && $emit('click')"
    @keydown.space.prevent="interactive && $emit('click')"
  >
    <slot />
  </tr>
</template>
