import type { MfaMethod } from '../entities/MfaMethod';
import { MfaRemovalDecision } from '../enums/MfaRemovalDecision';
import type { MfaMethodId } from '../types/MfaMethodId';

/**
 * Whether removing a method may proceed on the strength of the requesting
 * session alone, or a live proof of the second factor must accompany the
 * request.
 *
 * ## What "removal" threatens, and what proof answers it
 *
 * Removing a method is a way to remove it as a requirement: once the last
 * **confirmed** method is gone, {@link decideAuthenticationStep} has nothing
 * left to gate on and a proven credential alone is enough to sign in. That
 * makes the removal of a last confirmed method equivalent, for an attacker,
 * to defeating the second factor outright — so it must cost at least as much
 * as defeating it would. Removing *one of several* remaining confirmed
 * methods is permitted on the session alone. What makes that safe is not the
 * count but continuity of control: {@link decideMfaEnrollment} admits a new
 * factor only on a proof from one the account already holds, so every
 * confirmed method on an account traces back to the first. Without that rule
 * this decision would be sufficient to count and insufficient to protect — a
 * session that is not the owner's could add its own factor and then remove
 * theirs, and the account would still hold a confirmed method, which is all
 * this function checks.
 *
 * ## Removing an unconfirmed method is always allowed
 *
 * The word "confirmed" above is load-bearing, not decorative. ADR-0012 names
 * the last **confirmed** method as what re-authentication
 * protects — and {@link decideAuthenticationStep}'s own TSDoc already
 * establishes why an unconfirmed method is excluded from that word: it "is
 * not a weaker gate ... it is no gate at all", because nobody has ever
 * proven it can produce a valid response. A method that was never a gate
 * cannot be the gate removal threatens to remove, so removing one is never
 * the equivalent-to-defeating-the-second-factor event the paragraph above
 * describes — it is charged nothing, unconditionally, before this function
 * even asks what else remains. Charging it a proof anyway would fail the
 * exact person {@link decideAuthenticationStep} already refuses to lock
 * out: someone whose enrollment never finished has no confirmed method to
 * produce that proof from, so a rule that demanded one here would make
 * `REAUTHENTICATION_REQUIRED` permanent — an unconfirmed method, uniquely
 * among everything this function decides about, could never be deleted.
 * Two policies written for the same account must not disagree about what an
 * abandoned enrollment is worth; this is that agreement, enforced here.
 *
 * `validProofPresented` records ADR-0012's answer to *which* proof
 * re-authentication demands: a fresh proof of the **second factor being
 * removed or another confirmed one**, not the account's password. Two
 * reasons converge on that answer rather than the more familiar
 * "re-enter your password": an account that signed up through a federated
 * provider may hold no password at all, so a password challenge would be a
 * gate that some accounts simply cannot pass; and the threat this decision
 * defends against is a session that is already compromised, in which case
 * the password is no stronger a secret than the session token itself — only
 * a live second-factor proof establishes something the hijacker does not
 * already have.
 *
 * Pure: no clock, no store, no I/O. Whether `validProofPresented` is true is
 * decided by the caller, against whatever proof mechanism the method in
 * question actually uses; this function only decides what that boolean is
 * allowed to unlock.
 *
 * @param methods - every method on record for the account, confirmed and unconfirmed alike
 * @param methodId - the method the caller wants to remove
 * @param validProofPresented - whether a fresh second-factor proof accompanies this request
 * @returns `ALLOWED` when the method being removed was never confirmed, when
 *   a confirmed method survives the removal, or when the last confirmed one
 *   does not but a fresh proof was presented; otherwise
 *   `REAUTHENTICATION_REQUIRED`
 */
export function decideMfaRemoval(
  methods: readonly MfaMethod[],
  methodId: MfaMethodId,
  validProofPresented: boolean,
): MfaRemovalDecision {
  const target = methods.find((method) => method.id === methodId);
  if (target !== undefined && !target.isConfirmed()) return MfaRemovalDecision.ALLOWED;

  const remainingConfirmed = methods.filter(
    (method) => method.isConfirmed() && method.id !== methodId,
  );
  if (remainingConfirmed.length > 0) return MfaRemovalDecision.ALLOWED;

  return validProofPresented
    ? MfaRemovalDecision.ALLOWED
    : MfaRemovalDecision.REAUTHENTICATION_REQUIRED;
}
