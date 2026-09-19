import type { Ref } from 'vue';
import type { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { LastIdentityRemovalError } from '__FORGE_SCOPE__/core/identities/errors';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { IdentityHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';

/** The identities screen's state, and the two things it can do. */
export interface UseIdentities {
  /** Every way the actor can prove who they are. Empty until {@link load} resolves. */
  readonly identities: Ref<AuthIdentity[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed for a reason the screen has no name for. */
  readonly failed: Ref<boolean>;
  /**
   * Whether the last unlink was refused because it was the account's last.
   *
   * Kept apart from {@link failed} because it is the one refusal a person can act
   * on: it tells them to add another way in first. Every other failure is left
   * unnamed, for the reason `IdentityHttpService` gives about the backend's 404.
   */
  readonly lastRemaining: Ref<boolean>;
  /** Reads the list again, replacing what is held. */
  readonly load: () => Promise<void>;
  /** Unlinks one identity and re-reads the list. */
  readonly unlink: (identityId: AuthIdentityId) => Promise<void>;
}

/**
 * The actor's own identities, as a screen holds them.
 *
 * **The unlink rule is the server's and is not re-implemented here.** Whether an
 * identity is the account's last is decided by core's
 * `assertAtLeastOneIdentityRemains`, on the side that can see every identity the
 * account holds. What this composable does is carry the server's refusal back to
 * the screen under a name the screen can render, which is a different thing from
 * deciding it.
 *
 * @returns the list, its flags, and the two verbs a screen needs
 */
export function useIdentities(): UseIdentities {
  const store = useAuthStore();
  const identities = ref<AuthIdentity[]>([]);
  const loading = ref(false);
  const failed = ref(false);
  const lastRemaining = ref(false);

  async function load(): Promise<void> {
    const actor = store.user?.id;
    if (actor === undefined) {
      identities.value = [];
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      identities.value = await new IdentityHttpService(store.authenticatedClient())
        .listIdentities(actor);
    } catch {
      failed.value = true;
      identities.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function unlink(identityId: AuthIdentityId): Promise<void> {
    const actor = store.user?.id;
    if (actor === undefined) return;
    loading.value = true;
    failed.value = false;
    lastRemaining.value = false;
    try {
      await new IdentityHttpService(store.authenticatedClient()).unlinkIdentity(actor, identityId);
    } catch (error) {
      // The one refusal with a remedy the person can carry out. Everything else
      // stays unnamed.
      if (error instanceof LastIdentityRemovalError) lastRemaining.value = true;
      else failed.value = true;
    } finally {
      loading.value = false;
    }
    await load();
  }

  return { identities, loading, failed, lastRemaining, load, unlink };
}
