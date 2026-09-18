/**
 * Everything persisted about one password, and nothing else.
 *
 * The three fields map one-to-one onto `auth_identities.secret_hash`,
 * `secret_algorithm` and `secret_params` (see `AuthIdentityRecord`). Nothing is
 * derived at write time and nothing is inferred at read time, so the mapping
 * both ways is a rename and cannot lose anything.
 *
 * `params` is its own field rather than being left implicit in `hash` — argon2's
 * encoded string does carry `m`, `t` and `p`, so this looks redundant — because
 * {@link IPasswordHasher.needsRehash} must be answerable without knowing how to
 * parse any particular algorithm's encoding. `secret_params` is `jsonb`, so the
 * parameters arrive back as the numbers that were written and a rehash decision
 * is a comparison of numbers rather than a string match against a format that
 * only one implementation understands.
 *
 * Values are numbers because every cost parameter any password derivation takes
 * is a number, and because a comparison of "is the stored value weaker than the
 * current one" is only meaningful over an ordered type.
 */
export type StoredSecret = {
  /** The derivation itself, in whatever encoded form its algorithm defines. */
  hash: string;
  /** Which derivation produced `hash`, so a stored one can be recognized. */
  algorithm: string;
  /** The cost parameters `hash` was produced with. */
  params: Record<string, number>;
};

/**
 * The port through which a password becomes a stored value and back again.
 *
 * It lives in the backend rather than in core because core models no stored
 * secret at all — `AuthIdentity` has no field for one and never will (ADR-0005)
 * — so a hashing port in core would have nothing to hash, and would drag cost
 * parameters, which are a deployment's business, into a package that must stay
 * free of runtime concerns.
 */
export interface IPasswordHasher {
  /**
   * Derives a storable value from a password.
   *
   * @param secret - the password, in the clear
   * @returns the value to persist, salted so that two identical passwords do
   *   not produce identical rows
   * @throws WeakPasswordError when the secret exceeds the policy's maximum
   *   length — see the implementation for why that one rule, and only that one,
   *   is enforced here
   */
  hash(secret: string): Promise<StoredSecret>;

  /**
   * Answers whether a password reproduces a stored value.
   *
   * Never throws. A stored value this implementation cannot read is a `false`,
   * not an exception: it is reached from an unauthenticated path where an
   * exception and a rejection are distinguishable by an attacker, and where a
   * row corrupted or written by another implementation must not be able to take
   * the process down.
   *
   * @param secret - the password offered, in the clear
   * @param stored - the value persisted for this identity
   * @returns whether the two agree
   */
  verify(secret: string, stored: StoredSecret): Promise<boolean>;

  /**
   * Answers whether a stored value should be re-derived at the next successful
   * verification, because it was produced under parameters weaker than the ones
   * in force now.
   *
   * It reads `stored.params`, never a remembered version number: a version
   * number is a second record of the same fact that somebody has to remember to
   * bump, and the one that goes stale is the one that silently stops upgrading
   * anybody.
   *
   * @param stored - the value persisted for this identity
   * @returns whether it should be replaced
   */
  needsRehash(stored: StoredSecret): boolean;
}
