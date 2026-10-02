import type { Ref } from 'vue';
import type { Invitation } from '__FORGE_SCOPE__/core/organizations/entities';
import { InvitationStatus, type OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { InvitationId } from '__FORGE_SCOPE__/core/organizations/types';
import { OrganizationHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';

/** The invitations screen's state, and the three things it can do. */
export interface UseInvitations {
  /** The active organization's open invitations. Empty until {@link load} resolves. */
  readonly invitations: Ref<Invitation[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed. The reason is not kept — nothing renders one. */
  readonly failed: Ref<boolean>;
  /** Reads the list again, replacing what is held. Defaults to the open invitations. */
  readonly load: (status?: InvitationStatus) => Promise<void>;
  /** Invites an address into the active organization, and re-reads the list. */
  readonly invite: (email: string, role: OrgRole) => Promise<void>;
  /** Revokes an open invitation, and re-reads the list. */
  readonly revoke: (invitationId: InvitationId) => Promise<void>;
}

/**
 * The active organization's invitations, as a screen holds them.
 *
 * Scoped to `useOrganizationStore().activeOrganizationId` rather than taking an
 * organization as a parameter: every method here already reads `~/stores/auth`
 * for the actor the same way `useSessions` and `useIdentities` do, and reading
 * the active organization from its own store rather than a prop keeps this
 * composable callable from any screen under an organization without threading
 * an id through every one of them.
 *
 * With no active organization, every method is a no-op that empties the list —
 * the same "nothing to ask about" answer `useSessions.load` gives when nobody
 * is signed in, rather than a call that would be refused with no organization
 * to be refused *for*.
 *
 * @returns the list, its two flags, and the three verbs a screen needs
 */
export function useInvitations(): UseInvitations {
  const authStore = useAuthStore();
  const orgStore = useOrganizationStore();
  const invitations = ref<Invitation[]>([]);
  const loading = ref(false);
  const failed = ref(false);

  function service(): OrganizationHttpService {
    return new OrganizationHttpService(authStore.authenticatedClient());
  }

  async function load(status: InvitationStatus = InvitationStatus.PENDING): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) {
      invitations.value = [];
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      // The default is the contract: this composable's own meaning is "open
      // invitations", and an accepted or revoked one is no longer something
      // this screen is offering to manage. The parameter is the escape hatch
      // for a view that wants another status, so it need not bypass this
      // fetcher. `invite` and `revoke` re-read with no argument, which is what
      // makes a just-revoked invitation disappear from the list rather than
      // linger with a struck-through status nothing here would render.
      const page = await service().listInvitations(actor, organizationId, {
        page: 1,
        limit: 100,
        status,
      });
      invitations.value = page.data;
    } catch {
      failed.value = true;
      invitations.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function invite(email: string, role: OrgRole): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) return;
    loading.value = true;
    failed.value = false;
    try {
      await service().inviteMember(actor, organizationId, { email, role });
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
    await load();
  }

  async function revoke(invitationId: InvitationId): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) return;
    loading.value = true;
    failed.value = false;
    try {
      await service().revokeInvitation(actor, organizationId, invitationId);
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
    await load();
  }

  return { invitations, loading, failed, load, invite, revoke };
}
