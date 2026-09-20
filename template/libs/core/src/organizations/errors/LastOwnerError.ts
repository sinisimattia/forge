import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when an action would leave an organization with no OWNER.
 *
 * An organization always has at least one OWNER (spec §9.4), so the last one
 * can neither leave nor be demoted — either would leave the organization with
 * no member able to do the things only an OWNER may do, and no path back short
 * of intervention outside the domain.
 */
export class LastOwnerError extends DomainError {
  public constructor() {
    super('An organization must always have at least one OWNER.');
  }
}
