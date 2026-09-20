import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no membership answers to an id.
 *
 * It is also what a caller gets for a membership outside an organization it may
 * see: the two cases are deliberately indistinguishable, so that trying ids in
 * turn reveals nothing about which of them exist.
 */
export class MembershipNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No membership with id "${id}".`);
  }
}
