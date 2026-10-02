import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an invitation exists but is not open: it was revoked, already
 * accepted, or has expired.
 *
 * The three reasons collapse into one error on purpose (ADR-0010). An
 * invitation is single-use, and telling a caller which of the three closed it
 * would hand out three different pieces of information about an offer that
 * was never theirs — whether someone else already accepted, whether it was
 * revoked, or merely that time ran out. `isOpenAt` already answers the one
 * question that matters: no.
 */
export class InvitationNoLongerOpenError extends DomainError {
  /** @param id - the invitation that is no longer open */
  public constructor(id: string) {
    super(`Invitation "${id}" is no longer open.`);
  }
}
