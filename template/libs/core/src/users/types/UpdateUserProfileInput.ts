/**
 * The changes a person may make to their own profile.
 *
 * Every field is optional and an omitted field means "leave it alone", which is
 * what distinguishes this from the entity's own props. The address is not here
 * on purpose: changing it is a separate flow, because a new address has not
 * been proven and an account whose address changed silently would be a way to
 * take one over.
 */
export interface UpdateUserProfileInput {
  /** The new name shown to other people. */
  displayName?: string;
}
