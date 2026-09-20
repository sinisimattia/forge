import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a slug is not usable in a path — anything but lowercase letters,
 * digits and single, non-leading, non-trailing hyphens. See {@link Organization}
 * for why the slug is validated rather than derived.
 */
export class InvalidOrganizationSlugError extends DomainError {
  /** @param value - the offending value, as it was given */
  public constructor(value: string) {
    super(`"${value}" is not a usable organization slug.`);
  }
}
