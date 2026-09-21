import type { Ref } from 'vue';
import type { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { LastIdentityRemovalError } from '__FORGE_SCOPE__/core/identities/errors';
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import { IdentityHttpService, OAuthHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';

/** The identities screen's state, and the three things it can do. */
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
  /** Begins linking `provider`, and leaves this page for its consent screen. */
  readonly link: (provider: AuthProvider) => Promise<void>;
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
 * @returns the list, its flags, and the three verbs a screen needs
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

  /**
   * Begins linking `provider` to the actor's own account.
   *
   * It calls `OAuthHttpService.beginLink` — an authenticated request that
   * resolves with an authorization URL — and then assigns
   * `window.location.href` to it, a real top-level navigation for the same
   * reason `authorizationPathFor` gives for signing in: leaving this
   * application's origin for the provider's own consent screen is not
   * something a `fetch` can do.
   *
   * **Nothing a caller schedules after this call is guaranteed to run, and
   * this function is written so that nothing here depends on it either.**
   * It is declared `Promise<void>`, and under this project's test double
   * (`happy-dom`, which never actually navigates) that promise genuinely
   * settles — which is what lets the cases below observe
   * `window.location.href`. A real browser does not tear the document down
   * *synchronously* the instant `href` is assigned — navigation is queued as
   * a task, while this function's own return and an immediate `await` of it
   * are microtasks that generally finish first — but once that navigation
   * task is processed, the document and every script running on it can be
   * discarded at a point this function has no hook into. A caller that
   * chains real work onto this call's resolution — a re-read of the list,
   * a second request, anything beyond an already-queued synchronous
   * continuation — is racing an unload it can lose, silently, with no
   * error to catch. So `link`, unlike `unlink`, does not re-read the list
   * afterwards: there is nothing left for this screen to safely still be
   * doing by then.
   *
   * @param provider - which provider to link
   */
  async function link(provider: AuthProvider): Promise<void> {
    const actor = store.user?.id;
    if (actor === undefined) return;
    loading.value = true;
    failed.value = false;
    try {
      const url = await new OAuthHttpService(store.authenticatedClient()).beginLink(provider);
      window.location.href = url;
    } catch {
      // The request itself failed — the one part of this function a real
      // browser ever lets anyone observe. `failed` is the same generic flag
      // `load`/`unlink` use; there is no remedy specific to this refusal the
      // way there is for `lastRemaining`.
      failed.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { identities, loading, failed, lastRemaining, load, unlink, link };
}
