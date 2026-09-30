import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a recovery code is offered a second time.
 *
 * Each recovery code is meant to spend exactly once, the same way the codes
 * printed on a sheet of stamps are: accepting one again would turn a list
 * that exists to be used up under duress into one that could be replayed for
 * as long as a copy of it survived.
 */
export class RecoveryCodeAlreadyConsumedError extends DomainError {
  public constructor() {
    super('That recovery code has already been used.');
  }
}
