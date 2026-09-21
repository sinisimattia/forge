import type { Ref } from 'vue';
import type { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import { OrganizationAuditHttpService } from '~/services/organizationAudit.service';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';

/** The audit screen's state, and the one thing it can do. */
export interface UseAudit {
  /** The active organization's audit entries, newest first. Empty until {@link load} resolves. */
  readonly entries: Ref<AuditEntry[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed. The reason is not kept — nothing renders one. */
  readonly failed: Ref<boolean>;
  /** Reads the list again, replacing what is held. */
  readonly load: () => Promise<void>;
}

/**
 * The active organization's own audit history, as a screen holds it.
 *
 * Read-only, unlike every other composable this task adds: there is nothing
 * for a viewer of this screen to do to an entry, only to read it.
 * `~/services/organizationAudit.service.ts` explains why the service behind
 * this composable is not an `IAuditService` implementation.
 *
 * Scoped to `useOrganizationStore().activeOrganizationId`, the same shape
 * `useInvitations`, `useMembers` and `useGrants` follow, for the same reason.
 *
 * @returns the list and its two flags
 */
export function useAudit(): UseAudit {
  const authStore = useAuthStore();
  const orgStore = useOrganizationStore();
  const entries = ref<AuditEntry[]>([]);
  const loading = ref(false);
  const failed = ref(false);

  async function load(): Promise<void> {
    const actor = authStore.user?.id;
    const organizationId = orgStore.activeOrganizationId;
    if (actor === undefined || organizationId === null) {
      entries.value = [];
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      const service = new OrganizationAuditHttpService(authStore.authenticatedClient());
      const page = await service.queryForOrganization(actor, organizationId, {
        page: 1,
        limit: 100,
      });
      entries.value = page.data;
    } catch {
      failed.value = true;
      entries.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { entries, loading, failed, load };
}
