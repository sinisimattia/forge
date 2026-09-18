import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a provider account is offered to a second user.
 *
 * One provider account proves one person. Allowing two users to claim it would
 * make signing in with it ambiguous, and whichever user the implementation
 * happened to pick would be an account takeover of the other.
 */
export class IdentityAlreadyLinkedError extends DomainError {
  /**
   * @param provider - the provider the account belongs to
   * @param providerAccountId - the account identifier that is already spoken for
   */
  public constructor(provider: string, providerAccountId: string) {
    super(`The ${provider} account "${providerAccountId}" is already linked.`);
  }
}
