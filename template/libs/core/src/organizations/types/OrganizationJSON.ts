import type { OrganizationId } from './OrganizationId';

/**
 * The wire shape of an {@link Organization}: the same six facts, with every
 * instant as an ISO-8601 string, because a serialized payload has no `Date`.
 */
export interface OrganizationJSON {
  /** The organization's identifier. */
  id: OrganizationId;
  /** The name shown to its members. */
  name: string;
  /** The path segment identifying the organization. */
  slug: string;
  /** When the organization came into being. */
  createdAt: string;
  /** When the organization was last changed. */
  updatedAt: string;
  /** When the organization was soft-deleted, or `null` if it has not been. */
  deletedAt: string | null;
}
