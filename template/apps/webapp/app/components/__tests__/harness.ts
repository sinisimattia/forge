import type { Component } from 'vue';
import { defineComponent, h } from 'vue';
import { vi } from 'vitest';
import { useAudit } from '~/composables/useAudit';
import { useAuth } from '~/composables/useAuth';
import { useCan } from '~/composables/useCan';
import { useCurrentUser } from '~/composables/useCurrentUser';
import { useGrants } from '~/composables/useGrants';
import { useIdentities } from '~/composables/useIdentities';
import { useInvitations } from '~/composables/useInvitations';
import { useMembers } from '~/composables/useMembers';
import { useOrganization } from '~/composables/useOrganization';
import { useProfile } from '~/composables/useProfile';
import { usePasswordRecovery } from '~/composables/usePasswordRecovery';
import { useRegistration } from '~/composables/useRegistration';
import { useSessions } from '~/composables/useSessions';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';

/**
 * Everything a component needs to be mounted outside Nuxt, and nothing else.
 *
 * ## Why the real library is registered rather than stubbed
 *
 * A component in this application renders `<AppButton>` with no import
 * statement: Nuxt resolves the tag at build time and Vitest does not, so an
 * unregistered tag renders as an unknown element with its props as attributes.
 * Stubbing them would make every assertion about rendered text an assertion
 * about the stub — "the failure message is this string" would pass against a
 * component that passed the string to something that never displayed it.
 *
 * So the real atoms, molecules and organisms are registered, and what a spec
 * reads out of `wrapper.text()` is what a person would see.
 *
 * The glob is deliberate too: a hand-written list of components would go stale
 * the first time somebody adds one, and the failure would be an unknown tag in
 * an unrelated spec rather than anything pointing here.
 */
const LAYERS = [
  import.meta.glob('../atoms/*.vue', { eager: true }),
  import.meta.glob('../molecules/*.vue', { eager: true }),
  import.meta.glob('../organisms/*.vue', { eager: true }),
  import.meta.glob('../templates/*.vue', { eager: true }),
];

/**
 * `NuxtLink`, as far as anything under test is concerned.
 *
 * A real anchor rather than a stub element, because `AppLink`'s whole job is to
 * be a reachable control and a spec that accepted `<nuxt-link-stub>` would pass
 * for a link nobody can follow.
 */
const NuxtLink = defineComponent({
  name: 'NuxtLink',
  props: { to: { type: [String, Object], default: '/' } },
  setup(props, { slots }) {
    return () => h('a', { href: typeof props.to === 'string' ? props.to : '#' }, slots.default?.());
  },
});

/** Every project component, by the name Nuxt would register it under. */
export function libraryComponents(): Record<string, Component> {
  const registry: Record<string, Component> = { NuxtLink };
  for (const layer of LAYERS) {
    for (const [file, module] of Object.entries(layer)) {
      const name = file.slice(file.lastIndexOf('/') + 1, -'.vue'.length);
      registry[name] = (module as { default: Component }).default;
    }
  }
  return registry;
}

/** The `global` option every mount in these specs passes. */
export function mountOptions(): { components: Record<string, Component> } {
  return { components: libraryComponents() };
}

/** Every path `navigateTo` has been asked for, oldest first. */
export const navigations: string[] = [];

/**
 * The route the page under test believes it is on.
 *
 * A mutable module-level object rather than a per-mount option, because
 * `useRoute()` is an auto-import a page calls with no arguments: there is
 * nowhere to hand it one. A spec sets `route.query` before mounting.
 */
export const route: {
  query: Record<string, unknown>;
  meta: Record<string, unknown>;
  params: Record<string, unknown>;
} = {
  query: {},
  meta: {},
  params: {},
};

/** Every `useHead` argument, so a spec can assert a page set a title at all. */
export const heads: unknown[] = [];

/**
 * The globals a component of this application expects Nuxt to have provided.
 *
 * `stubNuxtAutoImports` covers the framework's own (`ref`, `computed`,
 * `useI18n`); this adds **this project's** composables, which Nuxt auto-imports
 * from `app/composables/` and Vitest does not. They are stubbed as *themselves*
 * — the real functions, over the real store — rather than as fakes. A fake
 * `useAuth` would make every spec in this directory a test of the fake: the
 * form would "sign in" against an object written in the test file, and the day
 * the store stopped issuing a credential every one of them would still pass.
 *
 * `navigateTo` is the one exception, because there is no router here and a
 * component that navigates is doing something a spec wants to observe rather
 * than perform.
 */
export function stubAutoImports(): void {
  stubNuxtAutoImports();
  navigations.length = 0;
  vi.stubGlobal('useAuth', useAuth);
  vi.stubGlobal('useCurrentUser', useCurrentUser);
  vi.stubGlobal('useIdentities', useIdentities);
  vi.stubGlobal('useProfile', useProfile);
  vi.stubGlobal('usePasswordRecovery', usePasswordRecovery);
  vi.stubGlobal('useRegistration', useRegistration);
  vi.stubGlobal('useSessions', useSessions);
  vi.stubGlobal('useOrganization', useOrganization);
  vi.stubGlobal('useInvitations', useInvitations);
  vi.stubGlobal('useMembers', useMembers);
  vi.stubGlobal('useGrants', useGrants);
  vi.stubGlobal('useAudit', useAudit);
  vi.stubGlobal('useCan', useCan);
  vi.stubGlobal('navigateTo', (to: string) => {
    navigations.push(to);
    return Promise.resolve();
  });
  vi.stubGlobal('useRuntimeConfig', () => ({
    apiBaseServer: '',
    public: { apiBase: 'http://backend.test', appName: 'Test' },
  }));
  // The three a page calls that a component does not. `definePageMeta` is a
  // compiler macro Nuxt erases at build time and plain Vitest does not, so it has
  // to exist as a function or every page throws on setup; it does nothing here,
  // which is correct — what it declares (layout, middleware) is Nuxt's to act on
  // and is asserted by the middleware's own specs, not by mounting a page.
  vi.stubGlobal('definePageMeta', () => undefined);
  vi.stubGlobal('useHead', (head: unknown) => {
    heads.push(head);
  });
  vi.stubGlobal('useRoute', () => route);
  route.query = {};
  route.meta = {};
  route.params = {};
  heads.length = 0;
}
