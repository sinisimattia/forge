/**
 * What a `mfa_challenges` row was minted for.
 *
 * Fixed by whichever endpoint created the row — `POST /auth/login` writes
 * `LOGIN`; `POST /mfa/webauthn/options` on an authenticated session writes
 * `WEBAUTHN_ENROLLMENT` — never by anything the request that later consumes
 * the challenge sends. `mfa_challenges.purpose` is a plain `text` column with
 * no `CHECK` (see `1758000005000-Mfa.ts`'s own TSDoc for why), so a reader of
 * that column is the only thing standing between a corrupted or future value
 * and whatever the purpose is used to decide. Dispatch on it the way
 * `OAuthAuthorizationPurpose` is dispatched in `oauth.service.ts`: explicit
 * equality per member, ending in an unconditional refusal — never a ternary
 * that reads "not LOGIN, so it must be enrollment". A ternary over an
 * unconstrained purpose column is how an authentication bypass looks right
 * up until the value it was never told about arrives: anything the ternary's
 * two arms do not distinguish is answered as whichever arm the "not A" branch
 * lands on, and a corrupted or future value lands there having proven
 * nothing.
 */
export enum MfaChallengePurpose {
  /** Completing a login already past the password step. */
  LOGIN = 'LOGIN',
  /** Confirming a newly enrolled WebAuthn credential on an authenticated session. */
  WEBAUTHN_ENROLLMENT = 'WEBAUTHN_ENROLLMENT',
}
