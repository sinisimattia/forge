import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when the account accepting an invitation does not hold the address
 * it was sent to.
 *
 * An invitation is addressed to an email, not to whoever happens to be signed
 * in when the link is opened — accepting it as anyone else would let a person
 * redeem an offer that was never sent to them just by being logged in when
 * they click it.
 */
export class InvitationAddressMismatchError extends DomainError {
  /** @param id - the invitation whose address the caller does not hold */
  public constructor(id: string) {
    super(`Invitation "${id}" was not addressed to this account.`);
  }
}
