import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no grant answers to an id.
 *
 * It is also what a caller gets for a grant that exists in an organization
 * other than the one they named: the two cases are deliberately
 * indistinguishable, so that trying ids in turn reveals nothing about which
 * exceptions another tenant has issued.
 */
export class GrantNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No grant with id "${id}".`);
  }
}
