import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a grant is issued in an organization to somebody who is not a
 * member of it.
 *
 * It is the contract-level half of "grants never widen into another tenant"
 * (spec §9.5). `can` enforces the other half by consulting the principal's
 * membership before it ever reaches a grant, so such a grant would decide
 * nothing — but a store that accepted it would hold a record saying an outsider
 * may edit a tenant's document, which reads as access whether or not anything
 * honours it. Refusing at the point of issue is what keeps the store's contents
 * and the rules in agreement.
 */
export class CrossTenantGrantError extends DomainError {
  /**
   * @param organizationId - the organization the grant was to be issued in
   * @param subjectUserId - the user who is not a member of it
   */
  public constructor(organizationId: string, subjectUserId: string) {
    super(
      `User "${subjectUserId}" is not a member of organization "${organizationId}", `
      + 'so no grant can be issued to them in it.',
    );
  }
}
