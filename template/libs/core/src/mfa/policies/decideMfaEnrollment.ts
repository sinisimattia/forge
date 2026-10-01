import type { MfaMethod } from '../entities/MfaMethod';
import { MfaEnrollmentDecision } from '../enums/MfaEnrollmentDecision';

/**
 * Whether a factor may be confirmed on the strength of the requesting session
 * alone, or a live proof from a factor the account already holds must
 * accompany it.
 *
 * ## What this protects, and why counting was not enough
 *
 * {@link decideMfaRemoval} guarantees that the set of confirmed methods never
 * empties without a live proof. That guarantee says nothing about *whose*
 * methods they are. A session that is not the owner's can add a factor of its
 * own, and once it has, removing the owner's leaves a confirmed method behind
 * and is permitted — so the account ends with a second factor the owner cannot
 * produce, and the removal guarantee never fires, because the set never
 * empties.
 *
 * The property that actually matters is not how many confirmed methods an
 * account has but that control of them is continuous: every factor after the
 * first is admitted by a factor already trusted. This function is where that
 * is stated. With it, the set of **confirmed** methods an account holds can
 * only ever be extended by somebody who can already prove one of them.
 *
 * The word "confirmed" is the whole of the claim, and the weaker reading is
 * wrong: a caller holding nothing but a session can put an *unconfirmed* method
 * on an account without proving anything, because enrolment begins before this
 * function is consulted and this function governs only the step that confirms.
 * An unconfirmed method is no gate — nobody has shown it can produce a valid
 * response — so admitting one costs the guarantee above nothing. It is not free
 * of every consequence, though: a caller's whole set of methods, unconfirmed
 * ones included, is what an enrolment cap counts, so the rows a session alone
 * can create are bounded somewhere other than here.
 *
 * ## The first factor is free, and must be
 *
 * An account with no confirmed method has nothing to prove with. Demanding a
 * proof there would not be a stronger rule; it would be an account that can
 * never enrol anything — the same permanent-lockout failure
 * {@link decideMfaRemoval} already refuses for an unconfirmed method, arrived
 * at from the other direction. "Confirmed" is load-bearing in the sentence
 * above for exactly that reason: a method nobody has ever proven can produce a
 * valid response is no gate, so it cannot be the gate that admits the next one.
 *
 * Pure: no clock, no store, no I/O. Whether `validProofPresented` is true is
 * decided by the caller against whatever proof mechanism the existing methods
 * use; this function only decides what that boolean is allowed to unlock.
 *
 * @param methods - every method on record for the account, confirmed and unconfirmed alike
 * @param validProofPresented - whether a fresh proof from an already-confirmed method accompanies this request
 * @returns `ALLOWED` when the account holds no confirmed method, or holds one
 *   and a fresh proof was presented; otherwise `REAUTHENTICATION_REQUIRED`
 */
export function decideMfaEnrollment(
  methods: readonly MfaMethod[],
  validProofPresented: boolean,
): MfaEnrollmentDecision {
  const hasConfirmed = methods.some((method) => method.isConfirmed());
  if (!hasConfirmed) return MfaEnrollmentDecision.ALLOWED;
  return validProofPresented
    ? MfaEnrollmentDecision.ALLOWED
    : MfaEnrollmentDecision.REAUTHENTICATION_REQUIRED;
}
