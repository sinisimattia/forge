import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no method answers to an id.
 *
 * It is also what a caller gets for a method belonging to somebody else: the
 * two cases are deliberately indistinguishable, so that trying ids in turn
 * reveals nothing about which of them exist or whose they are.
 */
export class MfaMethodNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No method with id "${id}".`);
  }
}
