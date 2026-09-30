import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when removing a method is attempted by a session that has not
 * itself proven the second factor recently.
 *
 * Removing a method is a way to remove it as a requirement, so the session
 * asking for that has to be held to at least the standard the method itself
 * enforces — otherwise the second factor could be turned off by anyone who
 * merely still held a signed-in tab, which is exactly the class of access it
 * exists to add a check beyond.
 */
export class MfaReauthenticationRequiredError extends DomainError {
  public constructor() {
    super('Removing this method requires a fresh proof of the second factor.');
  }
}
