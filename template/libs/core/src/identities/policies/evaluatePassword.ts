import type { PasswordPolicy } from '../types/PasswordPolicy';
import type { PasswordPolicyViolation } from '../types/PasswordPolicyViolation';

/**
 * Judges a proposed password against a policy, reporting **every** way it falls
 * short rather than stopping at the first.
 *
 * Returning all of them at once is the difference between telling a person what
 * to fix and making them discover it one rejection at a time. The order is
 * stable — length, then case, then digits — so a caller can render the list
 * without sorting it and two callers render it the same way.
 *
 * It judges only what the secret looks like. Whether the secret is already
 * public is a different question with a different answer source; see
 * {@link IBreachedPasswordRegistry}.
 *
 * @param secret - the password a person proposes
 * @param policy - the rules this deployment applies
 * @returns every violation, in a stable order; empty when the secret is acceptable
 */
export function evaluatePassword(
  secret: string,
  policy: PasswordPolicy,
): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];

  if (secret.length < policy.minLength) violations.push('TOO_SHORT');
  if (secret.length > policy.maxLength) violations.push('TOO_LONG');
  if (policy.requireMixedCase && !(/[a-z]/.test(secret) && /[A-Z]/.test(secret))) {
    violations.push('NEEDS_MIXED_CASE');
  }
  if (policy.requireDigit && !/[0-9]/.test(secret)) violations.push('NEEDS_DIGIT');

  return violations;
}
