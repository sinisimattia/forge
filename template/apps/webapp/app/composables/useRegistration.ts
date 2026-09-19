import { AuthHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';

/** Coming into being, and proving the address it was done with. */
export interface UseRegistration {
  /**
   * Begins registration.
   *
   * Three parameters rather than core's `RegisterInput`, matching
   * `useAuth().login(email, secret)`: what a screen holds is three form fields,
   * and assembling them into the contract's shape is this layer's job, not the
   * component's.
   *
   * @param email - the address the person supplied
   * @param displayName - the name they want shown to other people
   * @param secret - the secret they chose
   * @throws WeakPasswordError when the secret does not meet the policy — the one
   * refusal registration makes, and the only one it may make: everything else
   * resolves whether or not the address is already in use, because a
   * distinguishable failure is an enumeration oracle (`IAuthService.register`)
   */
  readonly register: (email: string, displayName: string, secret: string) => Promise<void>;
  /**
   * Consumes a verification token.
   *
   * @param credential - the single-use value delivered to the address
   * @throws ConsumedTokenError when it has already been used
   * @throws ExpiredTokenError when its lifetime has run out, or nothing answers to it
   */
  readonly verify: (credential: string) => Promise<void>;
  /**
   * Asks for verification to be sent again. Always resolves, known address or not.
   *
   * @param email - the address, as the person typed it
   */
  readonly resend: (email: string) => Promise<void>;
}

/**
 * Registration and address verification, as a screen reaches them.
 *
 * The third link of `STANDARDS.md` W2 — fetcher → service → composable →
 * component. It is thin on purpose: there is no state here that outlives a form,
 * so the pages hold their own, and what this owns is the one thing a page may
 * not — which transport the service is built on.
 *
 * Every method **re-throws core's error unchanged** rather than turning it into a
 * flag. The three pages that call these branch on `ConsumedTokenError` versus
 * `ExpiredTokenError` versus `WeakPasswordError`, and a boolean per outcome here
 * would be a second vocabulary for distinctions core already names — one that
 * silently loses a member the day core adds one.
 *
 * The service is built per call, for the reason `useSessions` gives.
 *
 * @returns the three verbs, each mapping to one contract method
 */
export function useRegistration(): UseRegistration {
  const store = useAuthStore();
  const service = (): AuthHttpService => new AuthHttpService(store.authenticatedClient());

  return {
    register: (email: string, displayName: string, secret: string) => (
      service().register({ email, displayName, secret })
    ),
    verify: (credential: string) => service().verifyEmail(credential),
    resend: (email: string) => service().resendVerification(email),
  };
}
