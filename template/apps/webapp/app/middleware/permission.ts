import type { Permission } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { useCan } from '~/composables/useCan';
import { useOrganizationStore } from '~/stores/organization';
import { SIGNED_IN_HOME } from '~/utils/redirect';

declare module 'vue-router' {
  interface RouteMeta {
    /**
     * What a page declaring `middleware: 'permission'` requires the actor to
     * be able to do. Read by this file; nothing else consults it.
     */
    permission?: Permission;
  }
}

/**
 * Hides a page the actor cannot use — **a convenience, not a control.**
 *
 * ADR-0006 in one sentence: the webapp calls the same `can()` the server
 * calls, so a page is unreachable through the navigation for exactly the
 * rule that would have refused the request it makes. This middleware is that
 * idea applied to a whole page rather than one button, through `useCan` and
 * no logic of its own.
 *
 * **It decides nothing that matters.** `useCan`'s own TSDoc says why: what it
 * reads is a principal that can already be stale, and nothing stops a request
 * reaching the backend some other way — directly, from a bookmarked URL, from
 * a page that does not declare this middleware, or from a person who opened
 * the browser's network tools. The one place a refusal is real is the server,
 * behind `PermissionsGuard`, which re-derives the same answer from its own
 * principal on every request regardless of what this function decides. That
 * server-side refusal is the one that counts, and it is asserted on the backend
 * side against `PermissionsGuard` itself; this
 * file only keeps somebody from *looking* at a page whose every action would
 * be refused.
 *
 * Declared by a page as `definePageMeta({ middleware: 'permission', permission:
 * 'member:invite' })`. **Nuxt finds it by the name of this file** — nothing
 * imports it — so renaming the file silently unprotects every page that named
 * it, exactly as `middleware/auth.ts`'s own TSDoc explains for `auth`.
 * `middleware/__tests__/permission.spec.ts` imports this exact path for the
 * same reason `auth.spec.ts` does.
 *
 * A page with no `permission` in its route meta is let through: this
 * middleware is not what makes a page require one, `definePageMeta` is, and a
 * page that forgot to name one is a page this middleware was never asked
 * about.
 *
 * ## Why it awaits before it decides
 *
 * `useOrganizationStore().principal` starts at `null` on every full page
 * load, the same way `useAuthStore().status` starts at `unknown` — the
 * principal has not been read yet, not "read and found to permit nothing".
 * `useCan` on an unresolved store answers `false` for everybody, which would
 * bounce every visitor on every hard refresh exactly as an un-awaited `auth`
 * would. So the store is awaited first, via the composable it exposes for
 * that (`initialize`, one hydration however many guards ask), and only then
 * is the permission read.
 *
 * ## Where the resource comes from
 *
 * `to.params.organizationId`, when the matched route names one — the layout
 * every organization-scoped page in this application shares. A route with no
 * such param passes `undefined`, which `can()` reads as "this permission
 * names no organization-scoped record" (`audit:read` at the platform level,
 * for instance), not as a refusal in itself.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const { permission } = to.meta;
  if (permission === undefined) return;

  await useOrganizationStore().initialize();

  const organizationIdParam = to.params.organizationId;
  const resource = typeof organizationIdParam === 'string'
    ? { organizationId: organizationIdParam as OrganizationId }
    : undefined;

  if (useCan(permission, resource).value) return;
  return navigateTo(SIGNED_IN_HOME);
});
