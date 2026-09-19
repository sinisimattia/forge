import type { ComputedRef } from 'vue';
import type { User } from '__FORGE_SCOPE__/core/users/entities';
import { useAuthStore } from '~/stores/auth';

/**
 * The signed-in person, or `null`.
 *
 * `useAuth().currentUser` says the same thing, and this exists because most
 * components want only that one value: a header, an avatar and a greeting all
 * read the person and none of them signs anybody in. Destructuring the larger
 * composable to get at one field makes the other four look available.
 *
 * `null` means two different things — nobody is signed in, or nobody has asked
 * yet — and a component that needs to tell them apart wants `useAuth().status`,
 * not this.
 *
 * @returns the person, rebuilt as core's entity from the store's wire record
 */
export function useCurrentUser(): ComputedRef<User | null> {
  const store = useAuthStore();
  return computed(() => store.currentUser);
}
