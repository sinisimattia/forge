import type { Ref } from 'vue';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import { AuthHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';
import type { OwnSession } from '~/types';

/** The sessions screen's state, and the two things it can do. */
export interface UseSessions {
  /** Every session the actor holds, newest first. Empty until {@link load} resolves. */
  readonly sessions: Ref<OwnSession[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Whether the last request failed. The reason is not kept — nothing renders one. */
  readonly failed: Ref<boolean>;
  /** Reads the list again, replacing what is held. */
  readonly load: () => Promise<void>;
  /** Ends one session and re-reads the list. */
  readonly revoke: (sessionId: SessionId) => Promise<void>;
}

/**
 * The actor's own sessions, as a screen holds them.
 *
 * The third link of `STANDARDS.md` W2 — fetcher → service → composable →
 * component — and the reason `SessionList` is a presentational organism with no
 * knowledge of the network at all.
 *
 * ## Why it re-reads after a revoke rather than splicing the row out
 *
 * Because the list it holds is a photograph and revoking is the one action that
 * makes a *different* photograph true. The obvious cheaper thing — drop the row
 * locally — is right for the revoked session and wrong for everything else on
 * the screen: another session may have been ended elsewhere in the meantime, and
 * a screen that silently keeps showing it is offering a button that will refuse.
 *
 * ## Why the service is built per call
 *
 * `adoptTransport` replaces the store's transport for the whole of a
 * server-rendered request, so a service captured when this composable was first
 * called would go on issuing through the wrong one. Building it at the call site
 * costs an object and removes the whole class.
 *
 * @returns the list, its two flags, and the two verbs a screen needs
 */
export function useSessions(): UseSessions {
  const store = useAuthStore();
  const sessions = ref<OwnSession[]>([]);
  const loading = ref(false);
  const failed = ref(false);

  async function load(): Promise<void> {
    const actor = store.user?.id;
    if (actor === undefined) {
      sessions.value = [];
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      // `listOwnSessions` and not the contract's `listSessions`: the screen marks
      // the session the person is using, and that fact is the server's to state.
      sessions.value = await new AuthHttpService(store.authenticatedClient())
        .listOwnSessions(actor);
    } catch {
      // Every failure means the same thing to this screen: the list could not be
      // read. It deliberately does not keep the reason — a refusal here is a
      // `SessionNotFoundError` by design, indistinguishable from "not yours",
      // and rendering that distinction is what the backend's 404 exists to stop.
      failed.value = true;
      sessions.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function revoke(sessionId: SessionId): Promise<void> {
    const actor = store.user?.id;
    if (actor === undefined) return;
    loading.value = true;
    failed.value = false;
    try {
      await new AuthHttpService(store.authenticatedClient()).revokeSession(actor, sessionId);
    } catch {
      failed.value = true;
    } finally {
      loading.value = false;
    }
    await load();
  }

  return { sessions, loading, failed, load, revoke };
}
