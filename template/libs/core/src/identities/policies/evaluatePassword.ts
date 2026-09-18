import type { PasswordPolicy } from '../types/PasswordPolicy';
import type { PasswordPolicyViolation } from '../types/PasswordPolicyViolation';

/**
 * Judges a proposed phrase against a policy, reporting **every** way it falls
 * short rather than stopping at the first.
 *
 * Returning all of them at once is the difference between telling a person what
 * to fix and making them discover it one rejection at a time. The order is
 * stable — length, then case, then digits — so a caller can render the list
 * without sorting it and two callers render it the same way.
 *
 * It judges only what the phrase looks like. Whether the phrase is already
 * public is a different question with a different answer source; see
 * {@link IBreachedPasswordRegistry}.
 *
 * @param candidate - the phrase a person proposes
 * @param policy - the rules this deployment applies
 * @returns every violation, in a stable order; empty when the phrase is acceptable
 */
export function evaluatePassword(
  candidate: string,
  policy: PasswordPolicy,
): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];

  if (candidate.length < policy.minLength) violations.push('TOO_SHORT');
  if (candidate.length > policy.maxLength) violations.push('TOO_LONG');
  if (policy.requireMixedCase && !(/[a-z]/.test(candidate) && /[A-Z]/.test(candidate))) {
    violations.push('NEEDS_MIXED_CASE');
  }
  if (policy.requireDigit && !/[0-9]/.test(candidate)) violations.push('NEEDS_DIGIT');

  return violations;
}
