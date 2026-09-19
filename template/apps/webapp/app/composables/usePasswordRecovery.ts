import { AuthHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';

/** Getting back in without the secret, and choosing a new one. */
export interface UsePasswordRecovery {
  /**
   * Begins recovery. Always resolves, known address or not — the same
   * enumeration rule registration follows.
   *
   * @param email - the address, as the person typed it
   */
  readonly request: (email: string) => Promise<void>;
  /**
   * Consumes a reset token and replaces the secret.
   *
   * **Ends every session the user holds**, including any open elsewhere
   * (`IAuthService.resetPassword`). Recovery is what somebody does when they may
   * have lost control of the account, so a surviving session would leave whoever
   * took it exactly where they were — and the screen that calls this has to say
   * so, or a person who was signed in on a phone reads it as a fault.
   *
   * @param credential - the single-use value delivered to the address
   * @param newSecret - the replacement secret
   * @throws ConsumedTokenError when it has already been used
   * @throws ExpiredTokenError when its lifetime has run out, or nothing answers to it
   * @throws WeakPasswordError when the replacement does not meet the policy
   */
  readonly reset: (credential: string, newSecret: string) => Promise<void>;
}

/**
 * Password recovery, as a screen reaches it.
 *
 * Changing a secret one **holds** is not here: that rotates the credential this
 * application is presenting, so it belongs to the store, and a screen reaches it
 * through `useAuth().changePassword`. Recovery does not, because whoever is
 * recovering is not signed in.
 *
 * @returns the two verbs, each mapping to one contract method
 */
export function usePasswordRecovery(): UsePasswordRecovery {
  const store = useAuthStore();
  const service = (): AuthHttpService => new AuthHttpService(store.authenticatedClient());

  return {
    request: (email: string) => service().requestPasswordReset(email),
    reset: (credential: string, newSecret: string) => (
      service().resetPassword(credential, newSecret)
    ),
  };
}
