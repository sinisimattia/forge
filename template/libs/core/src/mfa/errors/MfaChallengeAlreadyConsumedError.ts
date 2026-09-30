import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a proof arrives for a challenge that already answered one.
 *
 * A challenge is meant to be answered once: allowing a second proof against
 * it would make a captured response replayable for as long as the challenge
 * remains otherwise valid, which defeats the reason a fresh challenge is
 * issued for every attempt in the first place.
 */
export class MfaChallengeAlreadyConsumedError extends DomainError {
  /** @param id - the challenge that was already answered */
  public constructor(id: string) {
    super(`Challenge "${id}" has already been consumed.`);
  }
}
