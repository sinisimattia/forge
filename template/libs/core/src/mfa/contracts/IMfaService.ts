import type { UserId } from '../../users/types/UserId';
import type { MfaMethod } from '../entities/MfaMethod';
import type { MfaMethodId } from '../types/MfaMethodId';
import type { MfaProof } from '../types/MfaProof';
import type { RecoveryCodeBatch } from '../types/RecoveryCodeBatch';
import type { TotpEnrollmentOffer } from '../types/TotpEnrollmentOffer';

/**
 * Enrolling, confirming and removing a person's own second factors.
 *
 * Every method takes `actorId` — the user on whose behalf the call is made —
 * as its first parameter. Nothing is resolved from ambient state: an
 * implementation that decided for itself who was calling would be
 * impossible to reason about and impossible to test (ADR-0007).
 *
 * **A WebAuthn ceremony is not on this contract, and its absence is the
 * design.** Its options and its attestation/assertion payloads are WebAuthn
 * *protocol* vocabulary — a challenge, a credential descriptor, a signature
 * counter — not domain vocabulary, the same distinction ADR-0008 already
 * draws for an OAuth provider's authorization URL and token exchange. That
 * belongs to a backend façade built directly against the protocol, held to
 * its own suite there; this contract speaks only in what the domain needs
 * to say about a second factor, which is that one was enrolled, confirmed,
 * used, or removed.
 *
 * **Completing a sign-in with a second factor is not on this contract
 * either.** That is a step of {@link IAuthService.authenticate}'s own flow —
 * see `MfaStep` and `decideAuthenticationStep` — not a capability of
 * managing one's own methods after the fact, which is what this contract is
 * for.
 */
export interface IMfaService {
  /**
   * The actor's own methods, confirmed and unconfirmed alike. There is no
   * path to another user's.
   *
   * @param actorId - the user on whose behalf the call is made
   * @returns every method the actor currently holds, as entities
   */
  listMethods(actorId: UserId): Promise<MfaMethod[]>;

  /**
   * Begins enrolling a TOTP method: mints a shared secret and an unconfirmed
   * {@link MfaMethod} to hold it, without yet trusting either.
   *
   * The method this call creates cannot gate a sign-in or be offered as
   * something a client may challenge — see `decideAuthenticationStep` — until
   * {@link IMfaService.confirmTotpEnrollment} proves the person who asked for
   * it can actually produce a valid code from it. An abandoned offer that is
   * never confirmed gates nothing, but it is still a method the actor holds: it
   * counts toward the most methods an account may hold, as a confirmed one does,
   * and it frees its place only when it is removed.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param label - the name the person gives this method, so they can tell
   * it apart from another of the same kind later
   * @returns the shared secret, in every form a caller might need to show it
   * @throws MfaLabelRequiredError when the label is absent or only whitespace
   * @throws TooManyMfaMethodsError when the actor already holds the most methods
   *   an account may, confirmed or not
   */
  beginTotpEnrollment(actorId: UserId, label: string): Promise<TotpEnrollmentOffer>;

  /**
   * Finishes a TOTP enrollment by proving the person holds a working copy of
   * the secret {@link IMfaService.beginTotpEnrollment} minted.
   *
   * **A factor is admitted only by a factor the account already holds.** An
   * account with no confirmed method owes nothing here, because it has nothing
   * to prove with; once it has one, confirming another costs a fresh proof of
   * it, decided by `decideMfaEnrollment` over the account's methods as they
   * stand *before* this one is confirmed. Without the rule a session that is not
   * the owner's could enrol and confirm a factor of its own, and then remove the
   * owner's — which {@link IMfaService.removeMethod} permits whenever a
   * confirmed method remains.
   *
   * A batch of recovery codes comes back exactly once for an account: the
   * confirmation that gives the account its first confirmed method mints
   * them. A batch belongs to the **account**, not to any one method, so every
   * confirmation after that returns `null`; regenerating one is a separate,
   * deliberate act that costs a fresh proof (ADR-0012).
   * A caller that lets a non-`null` result go without showing or storing it
   * has lost those codes for good — the store never holds them in a form
   * this contract, or anything else, can read back out.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param methodId - the method {@link IMfaService.beginTotpEnrollment} offered
   * @param code - the time-based code the person's app produced for it
   * @param proof - a fresh proof of a second factor the account already
   * holds, or `null` when none is offered
   * @returns a fresh recovery code batch if this confirmation gave the
   * account its first confirmed method, otherwise `null`
   * @throws MfaMethodNotFoundError when the method is not theirs —
   * indistinguishable from not existing, so the call cannot be used to probe
   * for other people's ids
   * @throws MfaMethodAlreadyConfirmedError when the method has already been
   * confirmed once
   * @throws MfaReauthenticationRequiredError when the account already holds a
   * confirmed method and `proof` is `null`
   * @throws MfaVerificationFailedError when the code does not verify, or when a
   * proof was owed, was offered, and does not verify. A proof that is offered
   * but not owed is not checked at all
   * @throws RecoveryCodeAlreadyConsumedError when `proof` names a recovery
   * code that has already been used
   * @see decideMfaEnrollment — the domain policy that decides whether a proof
   * is owed. Every implementation calls it rather than restating the rule.
   */
  confirmTotpEnrollment(
    actorId: UserId,
    methodId: MfaMethodId,
    code: string,
    proof: MfaProof | null,
  ): Promise<RecoveryCodeBatch | null>;

  /**
   * Removes one of the actor's own methods.
   *
   * Whether `proof` may be omitted is `decideMfaRemoval`'s call, not this
   * method's own: an unconfirmed method was never a gate on anything (see
   * that policy's TSDoc) and comes off for free, and a confirmed method
   * that is not the account's last one costs nothing extra either. Only
   * removing the last confirmed method — the one call that would leave the
   * account with no second factor left to gate on — demands a proof, and it
   * must be a live one: the requesting session already proved it may manage
   * this account's methods, which is not the same fact as a working second
   * factor still being in the requester's hands.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param methodId - the method to remove
   * @param proof - a fresh proof of a second factor, or `null` when none is
   * offered
   * @throws MfaMethodNotFoundError when the method is not theirs —
   * indistinguishable from not existing, so the call cannot be used to probe
   * for other people's ids
   * @throws MfaReauthenticationRequiredError when removing this method would
   * leave the account with no confirmed method left, and `proof` is `null`
   * @throws MfaVerificationFailedError when a proof was owed, was offered, and
   * does not verify — a code that is wrong, one already used, or one for a
   * method that is not the actor's confirmed one. A proof that is offered but
   * not owed is not checked at all
   * @throws RecoveryCodeAlreadyConsumedError when `proof` names a recovery
   * code that has already been used
   * @see decideMfaRemoval — the domain policy that decides whether a proof
   * is owed. Every implementation of this method calls it rather than
   * restating the rule as its own count query, because a second copy of a
   * rule is a copy that can diverge.
   */
  removeMethod(actorId: UserId, methodId: MfaMethodId, proof: MfaProof | null): Promise<void>;

  /**
   * Replaces every recovery code the actor holds with a fresh batch,
   * invalidating whichever ones came before.
   *
   * Always demands a proof — unlike {@link IMfaService.removeMethod}, there
   * is no case here where the requesting session is enough on its own,
   * because the whole reason to regenerate is that the previous batch may
   * no longer be trustworthy (shown to somebody, or partly used up), and a
   * rule that skipped the proof exactly when the codes are suspect would
   * protect nothing.
   *
   * @param actorId - the user on whose behalf the call is made
   * @param proof - a fresh proof of a second factor
   * @returns the new batch, in the clear, exactly once
   * @throws MfaVerificationFailedError when `proof` names a method and code
   * that do not verify
   * @throws RecoveryCodeAlreadyConsumedError when `proof` names a recovery
   * code that has already been used
   */
  regenerateRecoveryCodes(actorId: UserId, proof: MfaProof): Promise<RecoveryCodeBatch>;
}
