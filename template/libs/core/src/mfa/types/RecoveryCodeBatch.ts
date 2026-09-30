/**
 * The one and only time a set of recovery codes is available in the clear.
 *
 * Spec §9.3: "Recovery codes are generated once, stored hashed, single-use."
 * A batch is minted the moment an account's first method is confirmed —
 * never again for that account, and never re-derivable from what the store
 * holds afterward, since the store holds only a digest of each code (see
 * `IMfaService.confirmTotpEnrollment` and `.regenerateRecoveryCodes`). A
 * caller that lets this value go without showing or storing it has lost the
 * codes as surely as if they had never been generated.
 */
export interface RecoveryCodeBatch {
  /** The plaintext codes, each usable exactly once, in the form the person keeps. */
  readonly codes: readonly string[];
}
