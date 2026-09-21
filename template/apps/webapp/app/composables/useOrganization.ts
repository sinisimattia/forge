import type { ComputedRef, Ref } from 'vue';
import type { PrincipalMembership } from '__FORGE_SCOPE__/core/authorization/types';
import type { Membership, Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import type { OrganizationId, UpdateOrganizationInput } from '__FORGE_SCOPE__/core/organizations/types';
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
  /**
   * The active organization's own record, or `null` before {@link load}
   * resolves or when nothing is active.
   *
   * Found in {@link organizations} rather than fetched on its own: every
   * organization-scoped page already calls {@link load} to populate the
   * switcher, and a second request for the one record this computed already
   * has among them would be a request with nothing behind it to justify.
   */
  readonly activeOrganization: ComputedRef<Organization | null>;
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
  /**
   * Creates an organization, with the actor as its OWNER, and re-reads the
   * list.
   *
   * Domain refusals (`OrganizationNameRequiredError`,
   * `InvalidOrganizationSlugError`) are rethrown rather than swallowed into
   * {@link failed} — `useProfile.save`'s own shape — because the page maps
   * each to the one field it names; a boolean flag cannot tell a caller
   * which.
   *
   * @throws OrganizationNameRequiredError when the name is blank
   * @throws InvalidOrganizationSlugError when the slug cannot be used in a path
   */
  readonly create: (name: string, slug: string) => Promise<Organization>;
  /**
   * Changes the active organization's name, its slug, or both, and re-reads
   * the list. Rethrows the same two domain refusals {@link create} does.
   */
  readonly update: (
    organizationId: OrganizationId,
    changes: UpdateOrganizationInput,
  ) => Promise<Organization>;
  /** Soft-deletes an organization, and re-reads the list. */
  readonly remove: (organizationId: OrganizationId) => Promise<void>;
  /**
   * Redeems an invitation by its token, creating the membership it offered,
   * and re-reads the list so the newly joined organization appears in it.
   *
   * Not scoped to `activeOrganizationId`, unlike every other verb here: the
   * whole point is that the actor is not yet a member of anything this call
   * names, so there is no active organization for it to read.
   */
  readonly acceptInvitation: (token: string) => Promise<Membership>;
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

  function service(): OrganizationHttpService {
    return new OrganizationHttpService(authStore.authenticatedClient());
  }

  async function create(name: string, slug: string): Promise<Organization> {
    const actor = authStore.user?.id;
    if (actor === undefined) throw new Error('Nobody is signed in.');
    const created = await service().createOrganization(actor, { name, slug });
    await load();
    return created;
  }

  async function update(
    organizationId: OrganizationId,
    changes: UpdateOrganizationInput,
  ): Promise<Organization> {
    const actor = authStore.user?.id;
    if (actor === undefined) throw new Error('Nobody is signed in.');
    const updated = await service().updateOrganization(actor, organizationId, changes);
    await load();
    return updated;
  }

  async function remove(organizationId: OrganizationId): Promise<void> {
    const actor = authStore.user?.id;
    if (actor === undefined) throw new Error('Nobody is signed in.');
    await service().deleteOrganization(actor, organizationId);
    await load();
  }

  async function acceptInvitation(token: string): Promise<Membership> {
    const actor = authStore.user?.id;
    if (actor === undefined) throw new Error('Nobody is signed in.');
    const membership = await service().acceptInvitation(actor, token);
    await load();
    return membership;
  }

  const activeMembership = computed<PrincipalMembership | null>(() => {
    const { principal, activeOrganizationId } = orgStore;
    if (principal === null || activeOrganizationId === null) return null;
    return principal.memberships.find(
      (membership) => membership.organizationId === activeOrganizationId,
    ) ?? null;
  });

  const activeOrganization = computed<Organization | null>(() => {
    const { activeOrganizationId } = orgStore;
    if (activeOrganizationId === null) return null;
    return organizations.value.find((one) => one.id === activeOrganizationId) ?? null;
  });

  return {
    organizations,
    loading,
    failed,
    activeOrganizationId: computed(() => orgStore.activeOrganizationId),
    activeMembership,
    activeOrganization,
    load,
    setActive,
    create,
    update,
    remove,
    acceptInvitation,
  };
}
