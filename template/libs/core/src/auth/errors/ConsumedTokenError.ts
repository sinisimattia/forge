import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a single-use token is presented a second time.
 *
 * Distinguished from {@link ExpiredTokenError} on purpose: the person holding
 * it really did hold a valid one, and telling them it has already been used is
 * the difference between "try again" and "you already did this". Nobody who did
 * not hold the token can reach this answer, so it reveals nothing to a guesser.
 */
export class ConsumedTokenError extends DomainError {
  public constructor() {
    super('That token has already been used.');
  }
}
