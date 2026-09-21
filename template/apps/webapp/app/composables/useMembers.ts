import type { Ref } from 'vue';
import type { Membership } from '__FORGE_SCOPE__/core/organizations/entities';
import type { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { OrganizationHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';

/** The members screen's state, and the two things it can do. */
export interface UseMembers {
  /** The active organization's members. Empty until {@link load} resolves. */
  readonly members: Ref<Membership[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed. The reason is not kept — nothing renders one. */
  readonly failed: Ref<boolean>;
  /** Reads the list again, replacing what is held. */
  readonly load: () => Promise<void>;
  /** Gives a member a different role, and re-reads the list. */
  readonly updateRole: (targetUserId: UserId, role: OrgRole) => Promise<void>;
  /** Ends a member's membership, and re-reads the list. */
  readonly remove: (targetUserId: UserId) => Promise<void>;
}

/**
 * The active organization's members, as a screen holds them.
 *
 * Scoped to `useOrganizationStore().activeOrganizationId`, the same shape
 * `useInvitations` follows and for the same reason: every method here already
 * reads `~/stores/auth` for the actor, and reading the active organization
 * from its own store rather than a prop keeps this composable callable from
 * any screen under an organization without threading an id through it.
 *
 * With no active organization, every method is a no-op that empties the
 * list — `useInvitations.load`'s own "nothing to ask about" answer, rather
 * than a call that would be refused with no organization to be refused *for*.
 *
 * @returns the list, its two flags, and the two verbs a screen needs
 */
export function useMembers(): UseMembers {
  const authStore = useAuthStore();
  const orgStore = useOrganizationStore();
  const members = ref<Membership[]>([]);
  const loading = ref(false);
  const failed = ref(false);

  function service(): OrganizationHttpService {
    return new OrganizationHttpService(authStore.authenticatedClient());
  }

  async function load(): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) {
      members.value = [];
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      const page = await service().listMembers(actor, organizationId, { page: 1, limit: 100 });
      members.value = page.data;
    } catch {
      failed.value = true;
      members.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function updateRole(targetUserId: UserId, role: OrgRole): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) return;
    loading.value = true;
    failed.value = false;
    try {
      await service().changeMemberRole(actor, organizationId, targetUserId, role);
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
    await load();
  }

  async function remove(targetUserId: UserId): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) return;
    loading.value = true;
    failed.value = false;
    try {
      await service().removeMember(actor, organizationId, targetUserId);
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
    await load();
  }

  return { members, loading, failed, load, updateRole, remove };
}
