import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an account already exists for an address, in a context where the
 * caller is entitled to know — linking an identity to a signed-in account, for
 * instance. It is never surfaced on registration or password recovery, where
 * telling a stranger that an address is taken is an enumeration oracle.
 */
export class EmailAlreadyRegisteredError extends DomainError {
  public constructor() {
    super('An account already exists for that address.');
  }
}
