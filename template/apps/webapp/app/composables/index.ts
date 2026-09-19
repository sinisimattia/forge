/**
 * The composables a component may call.
 *
 * Nuxt auto-imports every top-level export under `app/composables/`, so a
 * component writes `useAuth()` with no import line and this barrel is not what
 * makes that work. It is here for the callers that do import explicitly — the
 * specs, and anything outside a `.vue` file — and to keep that import path
 * stable if a composable is later split across files.
 */
export { useAuth } from './useAuth';
export type { UseAuth } from './useAuth';
export { useCurrentUser } from './useCurrentUser';
