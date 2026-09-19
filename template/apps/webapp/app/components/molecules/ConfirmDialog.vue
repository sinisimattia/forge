<script setup lang="ts">
interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  confirmLabel: undefined,
  confirmVariant: 'primary',
  loading: false,
});

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const { t } = useI18n();

const resolvedConfirmLabel = computed(
  () => props.confirmLabel ?? t('common.actions.confirm'),
);
</script>

<template>
  <AppOverlay :open="open" @close="emit('cancel')">
    <AppCard variant="elevated" class="w-full max-w-md shadow-xl">
      <AppHeading as="h3" size="sm">{{ title }}</AppHeading>
      <AppText color="secondary" class="mt-2">{{ message }}</AppText>
      <AppStack direction="row" justify="end" gap="md" class="mt-6">
        <AppButton
          variant="secondary"
          size="sm"
          :disabled="loading"
          @click="emit('cancel')"
        >
          {{ t('common.actions.cancel') }}
        </AppButton>
        <AppButton
          :variant="confirmVariant"
          size="sm"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ resolvedConfirmLabel }}
        </AppButton>
      </AppStack>
    </AppCard>
  </AppOverlay>
</template>
