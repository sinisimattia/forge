/**
 * The only time the codes it carries are readable.
 *
 * ADR-0012: recovery codes are "single-use, hashed at rest, shown once, and
 * regenerating them demands a fresh proof". **"Shown once" is about a batch,
 * not about an account.** Confirming an account's first second factor mints
 * one unasked, whichever kind of factor it is; after that a fresh batch comes
 * only from `IMfaService.regenerateRecoveryCodes`, which supersedes the batch
 * before it and charges that fresh proof for doing so.
 *
 * What holds of every batch is this value: the one moment its codes exist in
 * the clear. The store keeps only a digest of each, so nothing reads them back
 * out afterward. A caller that lets this value go without showing or storing
 * it has lost those codes as surely as if they had never been generated.
 */
export interface RecoveryCodeBatch {
  /** The plaintext codes, each usable exactly once, in the form the person keeps. */
  readonly codes: readonly string[];
}
