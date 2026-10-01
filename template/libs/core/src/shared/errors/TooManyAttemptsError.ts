import { DomainError } from './DomainError';

/**
 * Raised when something has been attempted more often than the budget for it
 * allows, and the caller must wait before attempting it again.
 *
 * ## Why this is a domain error and not an infrastructure one
 *
 * The rule it states is a domain rule: *an account may not be asked to prove
 * itself without limit.* A secret short enough for a person to read off a
 * screen is only as strong as the number of guesses it will tolerate, so the
 * budget is part of what the proof is worth rather than a detail of how the
 * attempt arrived. Counting the attempts — over what window, in what store,
 * shared between what processes — is infrastructure, and none of it is stated
 * here.
 *
 * It lives beside the other cross-domain primitives because the rule is not
 * one domain's: proving an identity, answering a challenge and spending a
 * recovery code are all attempts against the same kind of budget, and an
 * error per domain would be three names for one invariant.
 *
 * {@link TooManyAttemptsError.retryAfterSeconds} is modelled because the
 * caller it refuses is usually the rightful owner, who has typed something
 * wrong and needs to know when to try again. It is a duration rather than an
 * instant so that it says the same thing regardless of whose clock reads it.
 *
 * @param retryAfterSeconds - how long the caller must wait: a whole number of
 *   seconds, never negative, and `0` when the budget is spent but no remaining
 *   wait could be established — so a caller that presents it must tolerate zero
 *   rather than assume a positive delay
 */
export class TooManyAttemptsError extends DomainError {
  public constructor(public readonly retryAfterSeconds: number) {
    super('Too many attempts. Wait before trying again.');
  }
}
