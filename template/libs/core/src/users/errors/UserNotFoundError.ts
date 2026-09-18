import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no account answers to an id.
 *
 * It is also what a caller gets for an account it is not entitled to read: the
 * two cases are deliberately indistinguishable, so that trying ids in turn
 * reveals nothing about which of them exist.
 */
export class UserNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No user with id "${id}".`);
  }
}
