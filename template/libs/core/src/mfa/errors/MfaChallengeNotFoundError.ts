import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no challenge answers to an id.
 *
 * It is also what a caller gets for a challenge belonging to somebody else,
 * or one that never existed at all: the cases are deliberately
 * indistinguishable, so that trying ids in turn reveals nothing about which
 * of them are live.
 */
export class MfaChallengeNotFoundError extends DomainError {
  /** @param id - the identifier that matched nothing the caller may see */
  public constructor(id: string) {
    super(`No challenge with id "${id}".`);
  }
}
