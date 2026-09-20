import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an organization is constructed without a name, or with one that
 * is nothing but whitespace. The name is the only thing a member reads to tell
 * one organization from another, so the invariant is enforced at construction
 * rather than trusted.
 */
export class OrganizationNameRequiredError extends DomainError {
  public constructor() {
    super('An organization name is required.');
  }
}
