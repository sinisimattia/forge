import type { ComputedRef } from 'vue';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { Permission, Resource } from '__FORGE_SCOPE__/core/authorization/types';
import { useOrganizationStore } from '~/stores/organization';

/**
 * Whether the actor may do `permission`, evaluated by core's `can()` — the
 * whole point of ADR-0006 and of this composable.
 *
 * **It is a thin `computed` over `can(principal, permission, resource)` and
 * nothing else.** Not a re-implementation, not a lookup table, not a
 * comparison against a role: those would all pass a test that only checked
 * "does it return the right answer for one case", and would all disagree with
 * the server the day the rule changes and only `can()` is updated. Delegating
 * is what makes the answer identical to the one the server would give for the
 * same input — a button hidden by exactly the rule that would have refused
 * the request, rather than by a second statement of it that can drift.
 * `useCan.spec.ts`'s delegation test exists because "returns the right
 * answer" cannot tell the two apart; it asserts the call itself.
 *
 * **A client-side `true` is never a permission.** `useOrganizationStore`'s
 * `principal` is whatever `GET /users/me/principal` last answered, which can
 * be stale the instant a grant is revoked elsewhere, and nothing stops a
 * caller from reaching the underlying endpoint directly regardless of what
 * this returns. The server re-derives the same answer from its own principal
 * on every request; this composable only predicts it, to decide what to
 * render. See `can`'s own TSDoc and ADR-0006.
 *
 * `principal === null` — before `useOrganizationStore().initialize()` resolves,
 * or when nobody is signed in — answers `false` without calling `can()` at
 * all: there is no principal to evaluate, and refusing is the safe direction to
 * be wrong in while the answer is still unknown.
 *
 * @param permission - what the actor is asking to do
 * @param resource - the record it concerns, for the permissions that have one
 * @returns whether core's rules permit it, as of the principal held now
 */
export function useCan(permission: Permission, resource?: Resource): ComputedRef<boolean> {
  const store = useOrganizationStore();
  return computed(() => {
    const { principal } = store;
    if (principal === null) return false;
    return can(principal, permission, resource);
  });
}
