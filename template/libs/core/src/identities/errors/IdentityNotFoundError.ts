import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no identity answers to an id.
 *
 * It is also what a caller gets for an identity belonging to somebody else: the
 * two cases are deliberately indistinguishable, so that trying ids in turn
 * reveals nothing about which of them exist or whose they are.
 */
export class IdentityNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No identity with id "${id}".`);
  }
}
