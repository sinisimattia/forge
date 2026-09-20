/**
 * The changes a caller may make to an existing organization.
 *
 * Every field is optional and an omitted field means "leave it alone", which is
 * what distinguishes this from the entity's own props.
 */
export interface UpdateOrganizationInput {
  /** The new name shown to its members. */
  name?: string;
  /** The new path segment identifying the organization. */
  slug?: string;
}
