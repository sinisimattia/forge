import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a single-use token is presented after its lifetime has run out.
 *
 * An unknown token raises this too, and that is the point: a token nobody
 * issued and a token that has aged out are the same answer, so presenting
 * guesses in turn tells the guesser nothing about which ones were ever real.
 */
export class ExpiredTokenError extends DomainError {
  public constructor() {
    super('That token is no longer valid. Ask for a new one.');
  }
}
