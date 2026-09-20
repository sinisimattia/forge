import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no invitation answers to an id.
 *
 * Distinct from {@link InvitationNoLongerOpenError} on purpose: this is for an
 * id that was never issued at all, that one for an invitation that was issued
 * and has since closed. Collapsing the two would erase a fact a caller
 * managing invitations needs — whether there is anything left to revoke.
 */
export class InvitationNotFoundError extends DomainError {
  /** @param id - the identifier that matched no invitation */
  public constructor(id: string) {
    super(`No invitation with id "${id}".`);
  }
}
