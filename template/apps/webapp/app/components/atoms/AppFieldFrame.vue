<script setup lang="ts">
/**
 * The chrome around a form control: a label, whatever the control is, and a
 * message under it.
 *
 * **An atom, because two molecules need it.** `FormField` and `PasswordField`
 * are both "a labelled control with an error line", and the second was written
 * as a near-verbatim copy of the first — a molecule may not render another
 * molecule (W1), so composing `FormField` was not open to it. Copying is worse
 * than the rule it was avoiding: the layering check can see a molecule
 * rendering a molecule and cannot see two molecules drifting apart, so the copy
 * traded a violation the build catches for one nothing does.
 *
 * Written in raw HTML rather than out of the layout and text atoms, because an
 * atom renders no project component at all. The cost is that the utility
 * classes below restate what those two would emit for a gapless column and a
 * medium-weight label. That is a real duplication and a much smaller one: it is
 * a handful of class names in one file, visible side by side, rather than a
 * structure in two.
 *
 * (The class names of those two atoms are deliberately not quoted here. A tag
 * name inside a `<template>` comment is markup as far as
 * `scripts/check-atomic-layers.mjs` is concerned — it reads the whole root
 * block — so naming them there made this atom fail its own layering check.)
 */
interface Props {
  /** The visible label. Omitted, no label element is rendered at all. */
  label?: string;
  /** The `id` of the control this labels, so clicking the label focuses it. */
  id?: string;
  /** Whether to mark the field required with the asterisk every field uses. */
  required?: boolean;
  /** A message to show under the control. Empty renders nothing. */
  error?: string;
}

withDefaults(defineProps<Props>(), {
  label: '',
  id: undefined,
  required: false,
  error: '',
});
</script>

<template>
  <div class="flex flex-col items-stretch justify-start gap-0">
    <label
      v-if="label"
      :for="id"
      class="mb-1 block text-sm font-medium text-neutral-900"
    >
      {{ label }}
      <span v-if="required" class="text-sm font-normal text-error-600">*</span>
    </label>
    <slot />
    <p v-if="error" class="mt-1 text-sm font-normal text-error-600">{{ error }}</p>
  </div>
</template>
