import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an account is constructed without an address, or with one that is
 * nothing but whitespace. An account with no address has no way of proving who
 * holds it, so the invariant is enforced at construction rather than trusted.
 */
export class EmailRequiredError extends DomainError {
  public constructor() {
    super('An email address is required.');
  }
}
