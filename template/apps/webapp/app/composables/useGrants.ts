import type { Ref } from 'vue';
import type { GrantId, ResourceGrant } from '__FORGE_SCOPE__/core/authorization/types';
import { AuthorizationHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';

/** The grants screen's state, and the one thing it can do. */
export interface UseGrants {
  /** The active organization's resource grants. Empty until {@link load} resolves. */
  readonly grants: Ref<ResourceGrant[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed. The reason is not kept — nothing renders one. */
  readonly failed: Ref<boolean>;
  /** Reads the list again, replacing what is held. */
  readonly load: () => Promise<void>;
  /** Revokes a grant, and re-reads the list. */
  readonly revoke: (grantId: GrantId) => Promise<void>;
}

/**
 * The active organization's resource grants, as a screen holds them.
 *
 * **Deliberately read-only from this composable's own point of view: there is
 * no `create` here.** Issuing a grant means naming a `Permission` for the
 * subject to hold, and every `Permission` this application has is spelled
 * once, in core's own union — a webapp-local dropdown enumerating it would be
 * the first webapp-side list of permissions, and ADR-0006's whole argument
 * (see `useCan`'s own exhaustiveness proof) is that nothing here
 * enumerates one today, so a member added to core needs no matching edit in
 * this package. `GrantList` only ever shows and revokes grants that already
 * exist, which reads a grant's own `permission` field as a value rather than
 * switching on it, and needs none of that.
 *
 * Scoped to `useOrganizationStore().activeOrganizationId`, the same shape
 * `useInvitations` and `useMembers` follow, for the same reason.
 *
 * @returns the list, its two flags, and the one verb a screen needs
 */
export function useGrants(): UseGrants {
  const authStore = useAuthStore();
  const orgStore = useOrganizationStore();
  const grants = ref<ResourceGrant[]>([]);
  const loading = ref(false);
  const failed = ref(false);

  function service(): AuthorizationHttpService {
    return new AuthorizationHttpService(authStore.authenticatedClient());
  }

  async function load(): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) {
      grants.value = [];
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      const page = await service().listGrants(actor, organizationId, { page: 1, limit: 100 });
      grants.value = page.data;
    } catch {
      failed.value = true;
      grants.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function revoke(grantId: GrantId): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) return;
    loading.value = true;
    failed.value = false;
    try {
      await service().revokeGrant(actor, organizationId, grantId);
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
    await load();
  }

  return { grants, loading, failed, load, revoke };
}
