import { UserHttpService } from '~/services';
import { useAuthStore } from '~/stores/auth';

/** The one thing a person may change about their own record here. */
export interface UseProfile {
  /**
   * Replaces the actor's display name, and updates who the application thinks is
   * signed in.
   *
   * The second half is the part that is easy to leave out and impossible not to
   * notice: the header, the menu and the avatar all read the store, so a save
   * that only told the server would leave the old name on screen until the next
   * full page load, which reads as the save having failed.
   *
   * @param displayName - the name to be shown to other people
   * @throws DisplayNameRequiredError when it is blank or only whitespace
   */
  readonly save: (displayName: string) => Promise<void>;
}

/**
 * The actor's own profile, as a screen reaches it.
 *
 * @returns the one verb the profile screen needs
 */
export function useProfile(): UseProfile {
  const store = useAuthStore();

  return {
    save: async (displayName: string): Promise<void> => {
      const actor = store.user?.id;
      if (actor === undefined) throw new Error('Nobody is signed in.');
      const updated = await new UserHttpService(store.authenticatedClient())
        .updateProfile(actor, { displayName });
      store.adoptProfile(updated.toJSON());
    },
  };
}
