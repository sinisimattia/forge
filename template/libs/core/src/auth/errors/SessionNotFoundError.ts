import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no session the actor may see answers to an id.
 *
 * It is also what a caller gets for a session belonging to somebody else: the
 * two cases are deliberately indistinguishable, so that trying ids in turn
 * reveals nothing about which of them exist or whose they are.
 */
export class SessionNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No session with id "${id}".`);
  }
}
