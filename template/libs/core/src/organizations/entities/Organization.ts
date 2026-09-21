import { InvalidOrganizationSlugError } from '../errors/InvalidOrganizationSlugError';
import { OrganizationNameRequiredError } from '../errors/OrganizationNameRequiredError';
import type { OrganizationId } from '../types/OrganizationId';
import type { OrganizationJSON } from '../types/OrganizationJSON';
import type { OrganizationProps } from '../types/OrganizationProps';

/**
 * One tenant. Every membership, and everything reachable through a membership,
 * is scoped inside exactly one `Organization`.
 *
 * The entity carries no role of its own: `OrgRole` lives on `Membership`,
 * because the same organization can have many members and each may hold a
 * different role (spec §9.4).
 */
export class Organization {
  readonly id: OrganizationId;
  /** The name shown to its members, stored trimmed. */
  readonly name: string;
  /**
   * A stable, human-readable handle for the organization: supplied by the
   * caller, editable, shown wherever the organization itself is, and unique
   * per organization.
   *
   * Lowercase letters, digits and single hyphens, never leading or trailing.
   * **Not currently used in any URL** — nothing in this project builds a path
   * or a link from it today. The rule stays narrower than what a URL permits
   * anyway, and deliberately: it is *reserved* for that use, not put to it yet,
   * so a later phase can start putting it in a path with no migration and no
   * loosened regex to reconsider first. Say it that way and no other, or the
   * next reader inherits a claim this file no longer keeps.
   *
   * The entity does **not** derive this from the name. Two organizations
   * called "Acme Works" would collide on a value neither chose, and a rename
   * would silently invalidate anything that had already keyed off the old one.
   * The caller supplies it; this only refuses one that could not be reserved
   * for that future use.
   */
  readonly slug: string;
  /** When the organization came into being. */
  readonly createdAt: Date;
  /** When the organization was last changed. */
  readonly updatedAt: Date;
  /** Set by a soft delete. The record is retained; the organization is unusable. */
  readonly deletedAt: Date | null;

  private static readonly SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  /**
   * @param props - the six facts that make up an organization
   * @throws OrganizationNameRequiredError when the name is absent or only whitespace
   * @throws InvalidOrganizationSlugError when the slug cannot be used in a path
   */
  constructor(props: OrganizationProps) {
    const name = props.name.trim();
    if (name === '') throw new OrganizationNameRequiredError();
    if (!Organization.SLUG_RE.test(props.slug)) {
      throw new InvalidOrganizationSlugError(props.slug);
    }

    this.id = props.id;
    this.name = name;
    this.slug = props.slug;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.deletedAt = props.deletedAt;
  }

  /** Whether the organization has been soft-deleted. */
  get isDeleted(): boolean {
    return this.deletedAt !== null;
  }

  /** The wire shape: instants as ISO-8601 strings. */
  toJSON(): OrganizationJSON {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      deletedAt: this.deletedAt?.toISOString() ?? null,
    };
  }

  /**
   * Rebuilds an organization from its wire shape, re-running every invariant.
   *
   * @param json - an organization as it crosses a serialization boundary
   * @returns the same organization as a real entity, instants revived
   */
  static fromJSON(json: OrganizationJSON): Organization {
    return new Organization({
      id: json.id,
      name: json.name,
      slug: json.slug,
      createdAt: new Date(json.createdAt),
      updatedAt: new Date(json.updatedAt),
      deletedAt: json.deletedAt === null ? null : new Date(json.deletedAt),
    });
  }
}
