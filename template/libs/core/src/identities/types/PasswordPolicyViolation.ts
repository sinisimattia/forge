/**
 * One way a proposed phrase falls short of a {@link PasswordPolicy}.
 *
 * A string union rather than an enum because `types/` holds no runtime values:
 * these are names a caller matches on and shows a person, not a table anything
 * is stored against, so nothing is gained by giving them a runtime object.
 */
export type PasswordPolicyViolation
  = 'TOO_SHORT'
    | 'TOO_LONG'
    | 'NEEDS_MIXED_CASE'
    | 'NEEDS_DIGIT';
