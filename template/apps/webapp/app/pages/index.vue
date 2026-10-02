<script setup lang="ts">
const { t } = useI18n();

useHead({ title: t('home.title') });
</script>

<template>
  <AppContainer as="main" size="md">
    <AppSection size="xl">
      <AppStack gap="lg">
        <AppHeading as="h1" size="xl">
          {{ t('home.title') }}
        </AppHeading>
        <AppText size="base">
          {{ t('home.subtitle') }}
        </AppText>
        <AppStack direction="row" gap="md" wrap>
          <AppLink to="/login" variant="button">
            {{ t('home.signIn') }}
          </AppLink>
          <AppLink to="/register" variant="button-outline">
            {{ t('home.register') }}
          </AppLink>
        </AppStack>
      </AppStack>
    </AppSection>
  </AppContainer>
</template>
