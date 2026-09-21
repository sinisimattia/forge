import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when no invitation answers to an id.
 *
 * Distinct from {@link InvitationNoLongerOpenError} on purpose: this is for an
 * id that was never issued at all, that one for an invitation that was issued
 * and has since closed. Collapsing the two would erase a fact a caller
 * managing invitations needs — whether there is anything left to revoke.
 *
 * **That distinction is safe only while the identifier cannot be guessed**, and
 * it is the one precondition nothing here enforces. Elsewhere this project
 * collapses "you may not" into "there is no such thing" precisely because a
 * user or organization identifier *is* guessable, so a distinguishable answer
 * becomes a way to enumerate real ones. Redemption presents a credential drawn
 * at full entropy, so there is no set to enumerate and nothing to close.
 * Shorten that credential, make it human-typable, derive it from anything
 * predictable, or expose an invitation under a sequential identifier, and this
 * error and every answer built from it must be revisited together. ADR-0010
 * states the argument in full.
 */
export class InvitationNotFoundError extends DomainError {
  /** @param id - the identifier that matched no invitation */
  public constructor(id: string) {
    super(`No invitation with id "${id}".`);
  }
}
