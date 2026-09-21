import { defineStore } from 'pinia';
import type { Principal } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { getMyPrincipal } from '~/fetchers';
import type { PrincipalResponseBody } from '~/types';
import { useAuthStore } from './auth';

/**
 * The wire shape to the domain shape, field by field — never a cast.
 *
 * `memberships` crosses unchanged, but `grants` carries two instants that arrive
 * as ISO-8601 strings, because a serialized payload has no `Date`; `Principal`
 * promises `Date`, the same way `ResourceGrant` does on
 * `AuthorizationHttpService`'s own `toResourceGrant`, which this mirrors rather
 * than restates.
 *
 * @param wire - as `GET /users/me/principal` answers it
 * @returns the same three facts, revived
 */
function toPrincipal(wire: PrincipalResponseBody): Principal {
  return {
    userId: wire.userId,
    platformRole: wire.platformRole,
    memberships: wire.memberships,
    grants: wire.grants.map((grant) => ({
      ...grant,
      createdAt: new Date(grant.createdAt),
      expiresAt: grant.expiresAt === null ? null : new Date(grant.expiresAt),
    })),
  };
}

/**
 * The actor's own principal, and which organization is active — the input
 * `useCan` reads before calling core's `can()` (ADR-0006).
 *
 * ## Why the principal is hydrated, not assembled
 *
 * `GET /users/me/principal` is the **only** source: it exists
 * specifically so a client can evaluate the same rule the server does, and the
 * access credential deliberately carries no membership or grant of its own
 * (design ruling R4 on the backend). Assembling one from separate list calls —
 * "read my memberships, read my grants" — would let this store's idea of its
 * own memberships drift from the server's the moment either list changed
 * underneath it without a fresh read, which is exactly the drift ADR-0006
 * exists to prevent. So there is exactly one read here, and no field of
 * {@link Principal} is set from anywhere else.
 *
 * ## A client-side answer is never a permission
 *
 * Nothing this store holds authorizes anything by itself. `useCan` reads
 * `principal` to **predict** what the server will say, and the server
 * re-derives the same answer from its own principal on every request,
 * whatever this store believes. See `useCan`'s own TSDoc and ADR-0006.
 *
 * ## Why `ready` and not a boolean read straight off `principal`
 *
 * `principal.value === null` means two different things — "nobody has asked
 * yet" and "hydration ran and there is nobody signed in to have one" — and a
 * guard that cannot tell them apart from a `null` alone would either refuse
 * everybody on a full page load (the `unknown`-state bug `stores/auth.ts`
 * documents at length) or, worse, wave everybody through while still
 * unresolved. `ready` is that third state's boolean, matching `initialize`'s
 * own idempotence: `permission` middleware awaits it before reading
 * `principal` at all.
 */
export const useOrganizationStore = defineStore('organization', () => {
  /** The actor's own principal, or `null` before it is known or when signed out. */
  const principal = ref<Principal | null>(null);

  /** Which organization the application is currently scoped to, or `null`. */
  const activeOrganizationId = ref<OrganizationId | null>(null);

  /** Whether {@link initialize} has resolved at least once. */
  const ready = ref(false);

  /**
   * Reads the actor's principal again, replacing whatever was held.
   *
   * Unlike {@link initialize}, this always issues the request — a screen that
   * just changed a role or revoked a grant calls this to make `useCan` see the
   * consequence, rather than waiting for a fresh page load.
   */
  async function hydrate(): Promise<void> {
    const auth = useAuthStore();
    const actor = auth.user?.id;
    if (actor === undefined) {
      principal.value = null;
      ready.value = true;
      return;
    }
    try {
      principal.value = toPrincipal(await getMyPrincipal(auth.authenticatedClient(), actor));
    } catch {
      // A principal this store could not read is not a principal to authorize
      // anything with — `useCan` on `null` answers `false`, the safe direction,
      // and the server is asked again on the next request regardless of what
      // this store believes (ADR-0006).
      principal.value = null;
    } finally {
      ready.value = true;
    }
  }

  /**
   * Answers "is the principal known yet", once.
   *
   * `permission` middleware awaits this for the identical reason
   * `middleware/auth.ts` awaits `useAuthStore().initialize()`: on a full page
   * load nothing is hydrated yet, and a guard that read `principal` at that
   * moment would refuse everybody.
   */
  async function initialize(): Promise<void> {
    if (ready.value) return;
    const auth = useAuthStore();
    await auth.initialize();
    if (!auth.isAuthenticated) {
      principal.value = null;
      ready.value = true;
      return;
    }
    await hydrate();
  }

  /** Sets which organization is active. `null` clears it — there is no default. */
  function setActiveOrganization(organizationId: OrganizationId | null): void {
    activeOrganizationId.value = organizationId;
  }

  return {
    principal,
    activeOrganizationId,
    ready,
    hydrate,
    initialize,
    setActiveOrganization,
  };
});
