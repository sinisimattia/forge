import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  watchEffect,
} from 'vue';
import { vi } from 'vitest';

/**
 * Nuxt auto-imports (Vue reactivity APIs, `useI18n`, …) don't exist under Vitest — components
 * and composables call them without an import statement, relying on Nuxt's build-time
 * auto-import. We stub them as globals here so that mounting a real `.vue` SFC under
 * `@vue/test-utils` works without touching production code.
 *
 * Call this in a `beforeEach`, and pair it with `vi.unstubAllGlobals()` in `afterEach`.
 *
 * This only stubs the globals this skeleton's components happen to use today. If you
 * unit-test a component/page that calls a Nuxt auto-import not listed here (`useHead`,
 * `useRuntimeConfig`, and `navigateTo` are likely the next ones — `index.vue` already
 * calls `useHead`), add it as another `vi.stubGlobal(...)` line rather than working
 * around the missing global in the test.
 */
export function stubNuxtAutoImports(): void {
  vi.stubGlobal('ref', ref);
  vi.stubGlobal('computed', computed);
  vi.stubGlobal('reactive', reactive);
  vi.stubGlobal('watch', watch);
  vi.stubGlobal('watchEffect', watchEffect);
  vi.stubGlobal('onMounted', onMounted);
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount);
  vi.stubGlobal('onUnmounted', onUnmounted);
  vi.stubGlobal('nextTick', nextTick);
  // Echoes the key AND its interpolation params (rather than the bare key), so a spec
  // can assert on the actual interpolated output instead of a stub that discards params.
  vi.stubGlobal('useI18n', () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}|${JSON.stringify(params)}`,
  }));
}
