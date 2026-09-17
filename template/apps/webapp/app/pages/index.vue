<!--
  Exception to HTML-only-in-atoms (STANDARDS.md — Atomic Design hierarchy): this
  placeholder page ships raw `h1`/`p` on purpose, to prove the app renders before a
  single atom/molecule/organism exists. Delete this page and its exemption once you
  build your first real one — do not copy this file's raw HTML as the pattern.
-->
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
