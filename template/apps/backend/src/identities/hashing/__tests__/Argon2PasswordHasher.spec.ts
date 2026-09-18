import { WeakPasswordError } from '__FORGE_SCOPE__/core/identities/errors';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import { ARGON2ID, Argon2PasswordHasher } from '../Argon2PasswordHasher';
import type { StoredSecret } from '../IPasswordHasher';

/**
 * The parameters this suite asserts against are written out as LITERALS below
 * rather than imported from `CURRENT_PARAMS`, and that is the whole point of
 * them. An assertion that reads the same constant the implementation wrote
 * cannot fail, whatever that constant is changed to; these numbers can, and a
 * change to the cost parameters is meant to break this file and be looked at.
 */
const CURRENT = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const PLAINTEXT = 'a correct horse battery staple';

/** `$argon2id$v=19$m=..,t=..,p=..$<salt>$<digest>` → its five fields. */
const decode = (encoded: string) => {
  const [empty, algorithm, version, params, salt, digest] = encoded.split('$');
  expect(empty).toBe('');
  return { algorithm, version, params, salt, digest };
};

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  describe('hash', () => {
    it('salts, so the same secret twice produces two different stored values', async () => {
      const first = decode((await hasher.hash(PLAINTEXT)).hash);
      const second = decode((await hasher.hash(PLAINTEXT)).hash);

      // The two differ, AND what differs is the salt: the cost parameters are
      // identical in both, so the salt is the only input that changed and is
      // therefore the only thing the different digests can be explained by.
      // Asserting only that the two encodings differ would pass just as well if
      // the parameters were being randomised, which is not salting.
      expect(second.params).toBe(first.params);
      expect(second.salt).not.toBe(first.salt);
      expect(second.digest).not.toBe(first.digest);
    });

    it('records the algorithm and the parameters the derivation actually used', async () => {
      const stored = await hasher.hash(PLAINTEXT);

      // `algorithm` and `params` are asserted against the ENCODING the native
      // library produced, not against the constant the adapter holds, so the
      // three columns cannot claim one thing while the derivation did another.
      expect(stored.algorithm).toBe(decode(stored.hash).algorithm);
      expect(stored.algorithm).toBe(ARGON2ID);
      expect(decode(stored.hash).params).toBe(
        `m=${stored.params.memoryCost},t=${stored.params.timeCost},p=${stored.params.parallelism}`,
      );
      expect(stored.params).toEqual(CURRENT);
    });

    it('refuses a secret longer than the policy maximum', async () => {
      const overLong = 'x'.repeat(DEFAULT_PASSWORD_POLICY.maxLength + 1);

      await expect(hasher.hash(overLong)).rejects.toBeInstanceOf(WeakPasswordError);
      await expect(hasher.hash(overLong)).rejects.toMatchObject({ violations: ['TOO_LONG'] });
    });

    it('reads the maximum from the injected policy rather than a constant of its own', async () => {
      const bounded = new Argon2PasswordHasher({ ...DEFAULT_PASSWORD_POLICY, maxLength: 20 });

      await expect(bounded.hash('x'.repeat(21))).rejects.toBeInstanceOf(WeakPasswordError);
      await expect(bounded.hash('x'.repeat(20))).resolves.toMatchObject({ algorithm: ARGON2ID });
    });

    it('reports every violation, not only the one that decided the refusal', async () => {
      const strict = { ...DEFAULT_PASSWORD_POLICY, maxLength: 20, requireDigit: true };
      const overLongAndDigitless = new Argon2PasswordHasher(strict);

      await expect(overLongAndDigitless.hash('x'.repeat(21))).rejects.toMatchObject({
        violations: ['TOO_LONG', 'NEEDS_DIGIT'],
      });
    });

    it('accepts a secret that fails the policy in every way BUT length', async () => {
      // The lower bound is deliberately not enforced here — see the comment in
      // `hash`. Without this, "only the upper bound" is an unverified claim.
      const strict = { ...DEFAULT_PASSWORD_POLICY, requireDigit: true, requireMixedCase: true };

      await expect(new Argon2PasswordHasher(strict).hash('ab')).resolves.toMatchObject({
        algorithm: ARGON2ID,
      });
    });
  });

  describe('verify', () => {
    it('accepts the secret that produced the stored value and rejects another', async () => {
      const stored = await hasher.hash(PLAINTEXT);

      await expect(hasher.verify(PLAINTEXT, stored)).resolves.toBe(true);
      await expect(hasher.verify(`${PLAINTEXT}!`, stored)).resolves.toBe(false);
    });

    it.each([
      ['not an argon2 encoding at all', 'nonsense'],
      ['an empty string', ''],
      ['a truncated encoding', '$argon2id$v=19$m=19456,t=2,p=1'],
      ['a digest field that is not base64', '$argon2id$v=19$m=19456,t=2,p=1$####$####'],
      ['an algorithm this adapter does not know', '$scrypt$n=16384$c2FsdA$ZGlnZXN0'],
    ])('returns false rather than throwing for %s', async (_label, hash) => {
      await expect(hasher.verify(PLAINTEXT, { hash, algorithm: ARGON2ID, params: CURRENT }))
        .resolves.toBe(false);
    });

    it('refuses to derive anything for a secret longer than the policy maximum', async () => {
      // Failable, and this is how: the SAME secret and the SAME stored value
      // verify true under a policy that allows its length and false under one
      // that does not. A `false` on its own would prove nothing — a wrong secret
      // is false too. The difference between the two lines is the bound.
      const bounded = new Argon2PasswordHasher({ ...DEFAULT_PASSWORD_POLICY, maxLength: 20 });
      const stored = await bounded.hash('x'.repeat(20));

      await expect(bounded.verify('x'.repeat(20), stored)).resolves.toBe(true);

      const narrower = new Argon2PasswordHasher({ ...DEFAULT_PASSWORD_POLICY, maxLength: 19 });
      await expect(narrower.verify('x'.repeat(20), stored)).resolves.toBe(false);
    });
  });

  describe('needsRehash', () => {
    const storedWith = (params: Record<string, number>, algorithm = ARGON2ID): StoredSecret => ({
      // The derivation itself is never read by `needsRehash` — the decision is
      // made from `params`, which is exactly what makes it answerable without
      // parsing anyone's encoding. A placeholder here proves that.
      hash: 'irrelevant-to-this-decision',
      algorithm,
      params,
    });

    it('is false for a value produced with the parameters now in force', () => {
      expect(hasher.needsRehash(storedWith(CURRENT))).toBe(false);
    });

    it('is true for a value produced with weaker parameters', () => {
      expect(hasher.needsRehash(storedWith({ ...CURRENT, memoryCost: 9216 }))).toBe(true);
      expect(hasher.needsRehash(storedWith({ ...CURRENT, timeCost: 1 }))).toBe(true);
    });

    it('is false for a value produced with STRONGER parameters', () => {
      // Re-deriving one of these would replace a better stored value with a
      // worse one. "Weaker than", not "different from".
      expect(hasher.needsRehash(storedWith({ memoryCost: 65536, timeCost: 3, parallelism: 4 })))
        .toBe(false);
    });

    it('is true for a value produced by another algorithm', () => {
      expect(hasher.needsRehash(storedWith(CURRENT, 'bcrypt'))).toBe(true);
    });

    it.each([
      ['no parameters at all', {}],
      ['a missing parameter', { memoryCost: 19456, timeCost: 2 }],
    ])('is true for a value recording %s', (_label, params) => {
      expect(hasher.needsRehash(storedWith(params))).toBe(true);
    });

    it('is false for a value this adapter just produced', async () => {
      // Round-trip, not a restatement of the case above: it can fail if `hash`
      // writes `params` that are not the ones it derived with.
      expect(hasher.needsRehash(await hasher.hash(PLAINTEXT))).toBe(false);
    });
  });
});
