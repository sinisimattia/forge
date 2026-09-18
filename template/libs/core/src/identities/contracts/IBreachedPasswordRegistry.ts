/**
 * A source of knowledge about passwords that are already public.
 *
 * A port, not a vendor (ADR-0008): the template ships an implementation that
 * knows nothing, so a generated project has the seam without binding anyone's
 * account. Checking a proposed secret against a public corpus is the single
 * highest-value strength check there is, and far more useful than any
 * composition rule a {@link PasswordPolicy} can express — a secret already in a
 * published corpus is guessed first, however long or mixed it is.
 *
 * An implementation must never send the secret itself anywhere it would be
 * readable; what it sends and how is its own concern, which is precisely why
 * the domain states the question and not the method.
 */
export interface IBreachedPasswordRegistry {
  /**
   * Whether this password is known to be public already.
   *
   * @param secret - the password a person proposes
   * @returns `true` when the secret appears in the corpus this registry knows
   */
  isKnownBreached(secret: string): Promise<boolean>;
}
