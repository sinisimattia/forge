import type { ComputedRef, Ref } from 'vue';
import type { PrincipalMembership } from '__FORGE_SCOPE__/core/authorization/types';
import type { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { OrganizationHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';

/** The organization switcher's state, and the two things it can do. */
export interface UseOrganization {
  /** Every organization the actor belongs to. Empty until {@link load} resolves. */
  readonly organizations: Ref<Organization[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed. The reason is not kept — nothing renders one. */
  readonly failed: Ref<boolean>;
  /** Which organization is active, or `null`. */
  readonly activeOrganizationId: ComputedRef<OrganizationId | null>;
  /**
   * The actor's own membership in the active organization, or `null`.
   *
   * Read off `useOrganizationStore().principal` — the same hydrated principal
   * `useCan` reads — rather than found in {@link organizations}: a membership
   * is one of the three facts `can()`'s layer two consults, and this is that
   * fact, not a role reconstructed from the organization's own record.
   */
  readonly activeMembership: ComputedRef<PrincipalMembership | null>;
  /** Reads the list again, replacing what is held. */
  readonly load: () => Promise<void>;
  /**
   * Sets which organization is active.
   *
   * It does not re-hydrate the principal: switching organizations changes
   * which membership `activeMembership` reads and which `organizationId` a
   * caller passes `useCan` as a resource, but the principal itself — every
   * membership and grant the actor holds, everywhere — is unchanged by the
   * switch. Re-fetching here would be a request with nothing behind it to
   * have changed.
   */
  readonly setActive: (organizationId: OrganizationId | null) => void;
}

/**
 * The organizations the actor belongs to, and which one is active.
 *
 * The third link of `STANDARDS.md` W2 — fetcher → service → composable →
 * component — the same as every other composable in this package. The list
 * itself lives here, as a plain `ref`, the way `useSessions`' and
 * `useIdentities`' own lists do; what lives in the store instead is
 * `activeOrganizationId` and the `principal` it is compared against, because
 * those two are read by `useCan` from wherever a component happens to be, not
 * only from a switcher screen.
 *
 * @returns the list, its two flags, the active organization, and the two verbs
 */
export function useOrganization(): UseOrganization {
  const authStore = useAuthStore();
  const orgStore = useOrganizationStore();
  const organizations = ref<Organization[]>([]);
  const loading = ref(false);
  const failed = ref(false);

  async function load(): Promise<void> {
    const actor = authStore.user?.id;
    if (actor === undefined) {
      organizations.value = [];
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      const page = await new OrganizationHttpService(authStore.authenticatedClient())
        .listOrganizations(actor, { page: 1, limit: 100 });
      organizations.value = page.data;
    } catch {
      failed.value = true;
      organizations.value = [];
    } finally {
      loading.value = false;
    }
  }

  function setActive(organizationId: OrganizationId | null): void {
    orgStore.setActiveOrganization(organizationId);
  }

  const activeMembership = computed<PrincipalMembership | null>(() => {
    const { principal, activeOrganizationId } = orgStore;
    if (principal === null || activeOrganizationId === null) return null;
    return principal.memberships.find(
      (membership) => membership.organizationId === activeOrganizationId,
    ) ?? null;
  });

  return {
    organizations,
    loading,
    failed,
    activeOrganizationId: computed(() => orgStore.activeOrganizationId),
    activeMembership,
    load,
    setActive,
  };
}
