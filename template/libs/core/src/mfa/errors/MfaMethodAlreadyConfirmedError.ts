import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when confirmation is attempted on a method that already has one.
 *
 * Confirmation is the one transition from enrolled-but-unproven to trusted,
 * and it is meant to happen exactly once, against the proof offered at
 * enrollment time. Allowing it again would let a later, unrelated proof
 * silently re-arm a method that had already crossed that line, with no
 * record of which proof actually established trust in it.
 */
export class MfaMethodAlreadyConfirmedError extends DomainError {
  /** @param id - the method that was already confirmed */
  public constructor(id: string) {
    super(`Method "${id}" is already confirmed.`);
  }
}
