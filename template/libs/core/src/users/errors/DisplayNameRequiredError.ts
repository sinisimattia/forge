import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an account is left without a name to show other people. A blank
 * display name is rejected rather than defaulted, because a default would be
 * indistinguishable from a name the person actually chose.
 */
export class DisplayNameRequiredError extends DomainError {
  public constructor() {
    super('A display name is required.');
  }
}
