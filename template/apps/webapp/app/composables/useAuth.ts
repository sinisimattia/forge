import type { ComputedRef } from 'vue';
import type { User } from '__FORGE_SCOPE__/core/users/entities';
import { type AuthStatus, useAuthStore } from '~/stores/auth';
import type { LoginOutcome } from '~/types';

/** What a component gets when it asks who is signed in. */
export interface UseAuth {
  /** The signed-in person, or `null`. */
  readonly currentUser: ComputedRef<User | null>;
  /** Whether somebody is signed in. `false` while `status` is still `unknown`. */
  readonly isAuthenticated: ComputedRef<boolean>;
  /** Whether the question has been answered yet, and what the answer was. */
  readonly status: ComputedRef<AuthStatus>;
  /**
   * Proves who somebody is. Returns the outcome — core's, or a second-factor
   * challenge with its token taken off; a refusal is not a throw.
   */
  readonly login: (email: string, secret: string) => Promise<LoginOutcome>;
  /** Ends the session on the server, and forgets it here either way. */
  readonly logout: () => Promise<void>;
  /**
   * Replaces the actor's own secret, taking up the session that opens.
   *
   * On this surface and not in a composable of its own because it rotates the
   * credential the whole application presents — see the store's own note. A
   * screen calls it and re-renders; it does not have to know a credential was
   * replaced underneath it.
   */
  readonly changePassword: (currentSecret: string, newSecret: string) => Promise<void>;
}

/**
 * The third link of the chain `STANDARDS.md` W2 enforces — fetcher → service →
 * composable → component — and the only one of the four a component may call.
 *
 * It is deliberately thinner than it looks like it should be. Everything it
 * returns is the store's, because the store is where state that outlives a
 * component has to live: two components both showing the signed-in person's name
 * must show the *same* person, and a composable that held its own `ref` would
 * give each of them their own. What this adds over `useAuthStore()` is the
 * narrower surface — a component has no business calling `adoptTransport`,
 * `renew` or `initialize`, which are the application's own machinery.
 *
 * The three refs are `computed` wrappers rather than the store's own refs so
 * that a component cannot assign to them. Being signed in is not something a
 * component decides.
 *
 * `adoptTransport`, `authenticatedClient`, `renew` and `initialize` are the four
 * the narrowing exists for: the first two are how the application is wired
 * together and the last two are when it asks the backend a question, and a
 * component has business with none of them.
 *
 * @returns the signed-in person, whether there is one, and the two verbs
 */
export function useAuth(): UseAuth {
  const store = useAuthStore();
  return {
    currentUser: computed(() => store.currentUser),
    isAuthenticated: computed(() => store.isAuthenticated),
    status: computed(() => store.status),
    login: (email: string, secret: string) => store.login(email, secret),
    logout: () => store.logout(),
    changePassword: (currentSecret: string, newSecret: string) => (
      store.changePassword(currentSecret, newSecret)
    ),
  };
}
