import type { OrganizationId } from './OrganizationId';

/**
 * Everything needed to construct an {@link Organization}.
 *
 * A named object rather than positional parameters: with two adjacent instants
 * and a nullable third, a positional constructor makes a silent transposition
 * possible that no compiler can catch.
 */
export interface OrganizationProps {
  /** The organization's identifier. */
  id: OrganizationId;
  /** The name shown to its members; the entity stores it trimmed. */
  name: string;
  /**
   * The path segment identifying the organization. Not derived from `name` —
   * see {@link Organization}'s own TSDoc for why.
   */
  slug: string;
  /** When the organization came into being. */
  createdAt: Date;
  /** When the organization was last changed. */
  updatedAt: Date;
  /** When the organization was soft-deleted, or `null` if it has not been. */
  deletedAt: Date | null;
}
