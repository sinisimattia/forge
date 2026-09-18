import { DomainError } from '../../shared/errors/DomainError';
import type { PasswordPolicyViolation } from '../types/PasswordPolicyViolation';

/**
 * Raised when a proposed phrase does not meet the deployment's policy.
 *
 * It carries every violation rather than the first, because the list is what a
 * caller shows the person: telling them one thing to fix at a time turns a
 * single correction into several rounds of guessing.
 */
export class WeakPasswordError extends DomainError {
  /** Every way the phrase fell short, in the order the policy states them. */
  public readonly violations: readonly PasswordPolicyViolation[];

  /** @param violations - every way the proposed phrase fell short */
  public constructor(violations: readonly PasswordPolicyViolation[]) {
    super(`The proposed phrase does not meet the policy: ${violations.join(', ')}.`);
    this.violations = violations;
  }
}
