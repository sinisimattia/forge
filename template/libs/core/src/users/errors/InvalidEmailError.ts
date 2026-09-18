import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a value cannot be an address at all — no separator, nothing
 * either side of it, or whitespace inside it. The check is deliberately
 * shallow; the only real proof that an address exists is verification.
 */
export class InvalidEmailError extends DomainError {
  /** @param value - the offending value, as it was given */
  public constructor(value: string) {
    super(`"${value}" is not a usable email address.`);
  }
}
