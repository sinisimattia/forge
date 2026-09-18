import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a session's instants do not describe a period that could have
 * happened.
 *
 * One error rather than two, because there is one invariant with two ways of
 * being broken: a session runs from when it began until when it ends, and
 * everything true of it happened inside that span. A session that ended before
 * it started never existed, and one last used before it started was used by
 * nobody. Both are a store or a mapper producing instants in the wrong order,
 * and the message carries all three so that whichever one is wrong is visible
 * without reading the row.
 */
export class SessionLifetimeError extends DomainError {
  /**
   * @param createdAt - when the session is said to have begun
   * @param lastUsedAt - when it is said to have last been used
   * @param expiresAt - when it is said to end
   */
  public constructor(createdAt: Date, lastUsedAt: Date, expiresAt: Date) {
    super(
      'A session must end after it begins and cannot have been used before it began; got '
      + `createdAt ${createdAt.toISOString()}, `
      + `lastUsedAt ${lastUsedAt.toISOString()}, `
      + `expiresAt ${expiresAt.toISOString()}.`,
    );
  }
}
