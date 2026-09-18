import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an operation that must re-prove the actor's current secret is
 * given the wrong one.
 *
 * This is deliberately not what a failed sign-in produces. Failing to sign in
 * is an ordinary thing to do and is reported as an outcome, not a throw. This
 * error is for the operations that take a secret in order to re-prove somebody
 * already identified — changing their own secret, most of all — where offering
 * the wrong one is a fault rather than an answer.
 */
export class InvalidCredentialsError extends DomainError {
  public constructor() {
    super('The secret offered does not match the one on record.');
  }
}
