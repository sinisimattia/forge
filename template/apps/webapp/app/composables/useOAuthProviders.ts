import type { Ref } from 'vue';
import type { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import { OAuthHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';

/** The login page's read of which federated providers this deployment configured. */
export interface UseOAuthProviders {
  /** Every provider this deployment configured. Empty until {@link load} resolves. */
  readonly providers: Ref<AuthProvider[]>;
  /** Whether a request is in flight. */
  readonly loading: Ref<boolean>;
  /** Reads the list again, replacing what is held. */
  readonly load: () => Promise<void>;
}

/**
 * Which federated providers this deployment configured, as a login page reads them.
 *
 * **A failed read is treated as "no providers", never as an error.** There is
 * deliberately no `failed` flag here, unlike `useIdentities` and `useSessions`:
 * those screens are already behind `auth` middleware, so a failure there has
 * nowhere worse to send somebody than a retry. A login page is different —
 * it is the one screen an anonymous visitor cannot get past — and the
 * federated list is *decoration* on top of the one path that always works,
 * a password. If this deployment's backend is unreachable, slow, or answers
 * something this call cannot parse, the right behaviour is exactly what
 * ADR-0008 already requires for an unconfigured deployment: the federated
 * buttons are simply absent and the password form underneath is untouched.
 * Surfacing an error banner instead would put a visitor who can still sign in
 * perfectly well behind a fault that has nothing to do with their password.
 *
 * @returns the list, whether a read is in flight, and the one verb a screen needs
 */
export function useOAuthProviders(): UseOAuthProviders {
  const store = useAuthStore();
  const providers = ref<AuthProvider[]>([]);
  const loading = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      // No session exists yet for whoever is reading a login page — the same
      // client every other pre-authentication flow (`useRegistration`,
      // `usePasswordRecovery`) is built on, which presents no credential and
      // needs none for this route.
      providers.value = await new OAuthHttpService(store.authenticatedClient()).listProviders();
    } catch {
      // See this function's own TSDoc: a fault here is "no providers", not a
      // reason to tell a visitor who can still type a password that something
      // is wrong.
      providers.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { providers, loading, load };
}
