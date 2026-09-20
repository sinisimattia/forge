<script setup lang="ts">
/**
 * A labelled control with an error line.
 *
 * It is a thin wrapper over `AppFieldFrame` and that is the point: the chrome
 * lives in the atom so that `PasswordField`, which cannot render this molecule
 * (W1 forbids a molecule rendering its own layer), composes the same markup
 * instead of a copy of it. This layer is kept because every caller names it and
 * because a molecule is where a *composite* control belongs; what it composes is
 * now one atom instead of three.
 */
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
  <AppFieldFrame :id="id" :label="label" :required="required" :error="error">
    <slot />
  </AppFieldFrame>
</template>
