import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a proof does not verify against the method it was offered
 * for.
 *
 * It carries no detail about which part of the proof was wrong. A second
 * factor exists to resist guessing, and an error that distinguished "wrong
 * code" from "wrong device" from "expired" would hand a guesser the one
 * thing the factor is supposed to withhold: which guess was closer.
 */
export class MfaVerificationFailedError extends DomainError {
  public constructor() {
    super('The proof offered does not verify.');
  }
}
