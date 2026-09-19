<script setup lang="ts">
/**
 * The signed-in person's name, and the things they can do with their account.
 *
 * Imported from the project Forge was extracted from and adapted, not renamed.
 * Three of its assumptions were that project's and not this one's:
 *
 * - it read `user.firstName` and `user.lastName`. This domain's `User` carries a
 *   single `displayName` and has no name fields at all, so the initials are
 *   derived from that rather than from fields invented to keep the old code.
 * - it took its links from a `useUserMenu()` composable that does not exist here.
 *   The four account routes are named below, which is honest for a menu that has
 *   exactly one job; a composable would be indirection over a constant.
 * - it called `logout()` and ignored the promise. **This one cannot**: this
 *   application's `logout` clears the local session in a `finally` and then
 *   re-throws, because a server that was not reached still holds the session and
 *   whoever asked to end it is owed that. Unhandled, the rejection surfaces as an
 *   error to somebody who has in fact been signed out — the worst of both answers.
 */
const { currentUser, logout } = useAuth();
const { t } = useI18n();

const open = ref(false);
const menuRef = ref<HTMLElement | null>(null);

/** One entry in the menu: where it goes, and the key its label is written under. */
interface MenuLink {
  to: string;
  labelKey: string;
}

const MENU_LINKS: MenuLink[] = [
  { to: '/account/profile', labelKey: 'common.nav.profile' },
  { to: '/account/security', labelKey: 'common.nav.security' },
  { to: '/account/sessions', labelKey: 'common.nav.sessions' },
  { to: '/account/identities', labelKey: 'common.nav.identities' },
];

/**
 * Up to two initials, taken from the display name.
 *
 * `displayName` is one free-text field, so it is one word as often as two and
 * may be neither — the entity guarantees only that it is not blank. Taking the
 * first letter of the first two words handles "Ada Lovelace" and "Ada" alike,
 * and `?` covers the interval before anybody is known to be signed in, which is
 * every first render (`status` is `unknown` until the renewal answers).
 */
const initials = computed(() => {
  const name = currentUser.value?.displayName ?? '';
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0] ?? '');
  return letters.length === 0 ? '?' : letters.join('').toUpperCase();
});

function toggle(): void {
  open.value = !open.value;
}

function close(): void {
  open.value = false;
}

/**
 * Signs out, and goes somewhere a signed-out person may be.
 *
 * The rejection is swallowed **here and nowhere else**: by the time it arrives
 * the local session is already gone, so the only thing left to decide is what
 * the person sees, and an error beside an empty header would say the sign-out
 * had failed when it had not. The server-side session may genuinely still be
 * alive; that is a fact this screen cannot act on and must not pretend to.
 */
async function signOut(): Promise<void> {
  close();
  try {
    await logout();
  } catch {
    // Deliberately empty. See above.
  }
  await navigateTo('/');
}

function onClickOutside(pointer: MouseEvent): void {
  if (menuRef.value && !menuRef.value.contains(pointer.target as Node)) close();
}

onMounted(() => {
  document.addEventListener('click', onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', onClickOutside);
});
</script>

<template>
  <!-- bare div retained intentionally: it holds the `menuRef` template ref, used
       as a DOM element for click-outside detection. Wrapping it in an atom would
       make the ref a component instance and break `menuRef.contains()`. -->
  <div ref="menuRef" class="relative">
    <AppButton
      variant="unstyled"
      class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-neutral-700
        transition-colors hover:bg-neutral-100"
      @click="toggle"
    >
      <AppAvatar :initials="initials" size="sm" />
      <AppText as="span" weight="medium" color="default" class="hidden sm:inline">
        {{ currentUser?.displayName }}
      </AppText>
      <AppIcon name="chevron-down" size="sm" class="hidden text-neutral-400 sm:block" />
    </AppButton>

    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="scale-95 opacity-0"
      enter-to-class="scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-95 opacity-0"
    >
      <!-- bare div: an absolutely-positioned dropdown panel (a positioning shim);
           no layout atom models an anchored popover surface. -->
      <div
        v-if="open"
        class="absolute right-0 mt-1 w-48 origin-top-right rounded-md bg-surface py-1
          shadow-lg ring-1 ring-neutral-200"
      >
        <AppText as="span" size="xs" color="muted" class="block px-3 py-1.5">
          {{ currentUser?.email }}
        </AppText>
        <AppDivider class="my-1" />
        <AppLink
          v-for="link in MENU_LINKS"
          :key="link.to"
          :to="link.to"
          variant="sidebar"
          @click="close"
        >
          {{ t(link.labelKey) }}
        </AppLink>
        <AppDivider class="my-1" />
        <AppButton
          variant="unstyled"
          class="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          @click="signOut"
        >
          {{ t('common.nav.signOut') }}
        </AppButton>
      </div>
    </Transition>
  </div>
</template>
