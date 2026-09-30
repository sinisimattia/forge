import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a proof arrives for a challenge whose window has passed.
 *
 * A challenge is deliberately short-lived: the narrower the window, the
 * smaller the interval in which an intercepted or guessed proof could still
 * be replayed against it. Accepting a late proof would trade that guarantee
 * away for no benefit to the person who was genuinely trying to sign in.
 */
export class MfaChallengeExpiredError extends DomainError {
  /** @param id - the challenge whose window has passed */
  public constructor(id: string) {
    super(`Challenge "${id}" has expired.`);
  }
}
