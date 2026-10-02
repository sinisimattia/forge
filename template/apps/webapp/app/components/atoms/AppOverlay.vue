<script setup lang="ts">
interface Props {
  open: boolean;
  closeOnBackdrop?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  closeOnBackdrop: true,
});

const emit = defineEmits<{
  close: [];
}>();

function onBackdropClick() {
  if (props.closeOnBackdrop) {
    emit('close');
  }
}

// Escape is handled by the template's `@keydown.escape`, on the container rather than on a
// document-level listener: the container is the dialog, so a keystroke from anything
// focused inside it bubbles here, and the listener cannot outlive the element the way a
// document-level one does.
//
// The container therefore takes `tabindex="-1"` (programmatically focusable, not a tab
// stop) and is focused whenever it opens, so Escape works before the user has tabbed into
// the content. The backdrop itself stays unfocusable: a focusable backdrop would be an
// unlabelled tab stop sitting in front of the dialog.
const container = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    container.value?.focus();
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="container"
      class="fixed inset-0 z-50 flex items-center justify-center"
      tabindex="-1"
      @keydown.escape="emit('close')"
    >
      <div class="fixed inset-0 bg-backdrop/50" @click="onBackdropClick" />
      <div class="relative z-10 mx-4 w-full max-w-lg sm:mx-auto sm:w-auto">
        <slot />
      </div>
    </div>
  </Teleport>
</template>
