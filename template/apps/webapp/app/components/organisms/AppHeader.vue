<script setup lang="ts">
/**
 * The bar across the top: the wordmark, and either who is signed in or the two
 * ways to become so.
 *
 * Both routes it links to — `/login` and `/register` — exist in this
 * application, and it references no other; `UserMenu` behind `isAuthenticated`
 * is the only other thing it renders.
 *
 * `isAuthenticated` is `false` while the answer is still `unknown`, so the first
 * server-rendered frame of a signed-in person's page shows the signed-out pair.
 * That is not a flash here: the SSR plugin awaits the renewal *before* the render
 * begins (`plugins/auth-init.server.ts`), so by the time this component runs the
 * question has an answer. A deployment that removed that plugin would see it, and
 * would see it here first.
 */
interface Props {
  containerSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

withDefaults(defineProps<Props>(), {
  containerSize: 'xl',
});

const { isAuthenticated } = useAuth();
const { t } = useI18n();
</script>

<template>
  <AppStack as="header" class="border-b border-neutral-200 bg-surface">
    <AppContainer :size="containerSize" as="nav">
      <AppStack direction="row" align="center" justify="between" class="h-16">
        <AppLogo />
        <UserMenu v-if="isAuthenticated" />
        <AppStack v-else direction="row" align="center" gap="lg">
          <AppLink to="/login" variant="nav">{{ t('common.nav.signIn') }}</AppLink>
          <AppLink to="/register" variant="nav">{{ t('common.nav.register') }}</AppLink>
        </AppStack>
      </AppStack>
    </AppContainer>
  </AppStack>
</template>
