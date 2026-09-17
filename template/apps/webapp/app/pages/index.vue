<script setup lang="ts">
const { t } = useI18n();

useHead({ title: t('home.title') });
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
    <h1 class="text-3xl font-semibold">
      {{ t('home.title') }}
    </h1>
    <p class="text-slate-600">
      {{ t('home.subtitle') }}
    </p>
  </main>
</template>
