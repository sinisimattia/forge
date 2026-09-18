import type { PasswordPolicy } from '../types/PasswordPolicy';

/**
 * The policy a generated project starts from.
 *
 * Length is the only rule switched on, because length is where almost all of
 * the strength is: a long secret a person can actually remember resists
 * guessing far better than a short one forced through a composition rule.
 *
 * `requireMixedCase` and `requireDigit` therefore default to `false`, and that
 * is a decision rather than an omission. A composition rule does not make
 * people choose unpredictable passwords; it makes them apply a predictable
 * transformation to the one they had already chosen — capitalising the first
 * letter, appending a `1` — which a guessing attack models cheaply while every
 * person pays the cost of remembering the transformation. The knobs are exposed
 * rather than removed because a deployment may be obliged to switch them on by
 * a rule it does not get to argue with; the point is that a project's author
 * turns them on deliberately instead of inheriting them switched on by
 * accident.
 *
 * The far more valuable check — is this secret already public? — is not a knob
 * here at all. It is {@link IBreachedPasswordRegistry}, because it needs a
 * source of knowledge no constant can hold.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  // A bound exists because a derivation's cost grows with its input, and an
  // unbounded secret is a way to make a server do unbounded work.
  maxLength: 200,
  requireMixedCase: false,
  requireDigit: false,
};
