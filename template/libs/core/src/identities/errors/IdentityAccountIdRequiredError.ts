import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an identity is offered with no account identifier.
 *
 * An identity with nothing to match on cannot prove anything: it would be a row
 * every lookup silently skipped, and a person holding one would be unable to
 * sign in for a reason nothing in the model could name.
 */
export class IdentityAccountIdRequiredError extends DomainError {
  /** @param provider - the provider the identifier was missing for */
  public constructor(provider: string) {
    super(`A ${provider} identity needs an account identifier.`);
  }
}
