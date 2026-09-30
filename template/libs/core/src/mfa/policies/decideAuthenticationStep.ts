import type { MfaMethod } from '../entities/MfaMethod';
import { MfaStep } from '../enums/MfaStep';
import type { AuthenticationStepDecision } from '../types/AuthenticationStepDecision';

/**
 * Whether a session may be issued once credentials are proven, or a second
 * factor is still owed.
 *
 * ## The one thing this function's whole reason for existing rests on
 *
 * **An unconfirmed method is not a weaker gate than a confirmed one — it is
 * no gate at all.** Confirmation is the proof that whoever enrolled the
 * method can actually produce a valid response from it (a TOTP code that
 * verifies against the secret, a WebAuthn signature that verifies against the
 * public key); a method nobody has ever proven might belong to an app that
 * was never actually set up, a QR code that was scanned into the wrong app,
 * or an authenticator that was lost before enrollment finished. Gating
 * sign-in on a method like that does not raise the bar for an attacker — it
 * locks out the legitimate owner, who by definition cannot produce the proof
 * the unfinished enrollment demands, and who has no other route back in
 * because the whole point of a second factor is that nothing else substitutes
 * for it. An abandoned enrollment must therefore cost nothing: this function
 * filters to confirmed methods *first*, and only what survives that filter
 * can turn `ISSUE_SESSION` into `REQUIRE_SECOND_FACTOR`.
 *
 * The methods returned alongside `REQUIRE_SECOND_FACTOR` are that same
 * filtered list, for the same reason in the other direction: offering an
 * unconfirmed method as something a client can challenge would ask a person
 * to prove a method that was never capable of producing a valid proof in the
 * first place.
 *
 * Pure: no clock, no store, no I/O. Everything it needs is in `methods`.
 *
 * @param methods - every method on record for the account that just proved its credentials
 * @returns `ISSUE_SESSION` when no confirmed method exists; otherwise
 *   `REQUIRE_SECOND_FACTOR` carrying only the confirmed methods
 */
export function decideAuthenticationStep(
  methods: readonly MfaMethod[],
): AuthenticationStepDecision {
  const confirmed = methods.filter((method) => method.isConfirmed());
  if (confirmed.length === 0) return { step: MfaStep.ISSUE_SESSION };
  return { step: MfaStep.REQUIRE_SECOND_FACTOR, methods: confirmed };
}
