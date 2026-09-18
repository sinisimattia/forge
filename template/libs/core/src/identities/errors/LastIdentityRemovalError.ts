import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when unlinking would leave a user with no way to prove who they are.
 *
 * The account would still exist and still be readable, but nobody — including
 * its owner — could ever reach it again, and no operation the owner is able to
 * perform would put it back. It is refused rather than warned about because it
 * is not recoverable by the person who caused it (ADR-0005).
 */
export class LastIdentityRemovalError extends DomainError {
  public constructor() {
    super('Removing that identity would leave the account with no way in.');
  }
}
