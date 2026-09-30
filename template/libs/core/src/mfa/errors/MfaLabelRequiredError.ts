import { DomainError } from '../../shared/errors/DomainError';

/**
 * Raised when a method is offered with no label, or one that is only
 * whitespace.
 *
 * A person may enroll more than one method of the same kind, and the label is
 * the only thing that tells two methods of that kind apart in a list they are
 * choosing from or removing from. A method with no label would be a row that
 * every such list rendered identically to another.
 */
export class MfaLabelRequiredError extends DomainError {
  public constructor() {
    super('A method needs a label to tell it apart from another of the same kind.');
  }
}
