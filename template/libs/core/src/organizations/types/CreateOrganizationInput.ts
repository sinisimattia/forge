/** What a caller must supply to create an organization. */
export interface CreateOrganizationInput {
  /** The name shown to its members. */
  name: string;
  /** The path segment identifying the organization. */
  slug: string;
}
