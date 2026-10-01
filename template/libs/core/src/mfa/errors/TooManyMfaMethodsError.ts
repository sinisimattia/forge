import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an account is asked to hold more second-factor methods than it
 * may.
 *
 * Every method the account holds counts toward the limit, including one that
 * was begun and never confirmed: an unconfirmed method is still a stored row,
 * and an actor who has only a session can create them without proving anything.
 * The refusal is about the account's current holdings, not about the request —
 * the same request is accepted once a method has been removed.
 */
export class TooManyMfaMethodsError extends DomainError {
  /** @param limit - the most methods one account may hold */
  public constructor(limit: number) {
    super(`An account may hold at most ${limit} second-factor methods.`);
  }
}
