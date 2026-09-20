import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no organization answers to an id.
 *
 * It is also what a caller gets for an organization it is not a member of: the
 * two cases are deliberately indistinguishable, so that trying ids in turn
 * reveals nothing about which of them exist.
 */
export class OrganizationNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No organization with id "${id}".`);
  }
}
