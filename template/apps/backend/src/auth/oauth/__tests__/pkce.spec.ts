import { createHash } from 'node:crypto';
import { createPkcePair } from '../pkce';

/**
 * `createPkcePair` — the verifier and its `S256` challenge.
 *
 * The digest assertion below computes the expected challenge with its own
 * call to `createHash`, independent of the helper under test, rather than by
 * calling `createPkcePair` a second time or reaching into its implementation.
 * An assertion built from the same function it is checking would prove only
 * that the function agrees with itself.
 */
describe('createPkcePair', () => {
  it('draws a verifier of 43 base64url characters — 32 bytes, RFC 7636 range', () => {
    const { verifier } = createPkcePair();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('differs across calls', () => {
    const first = createPkcePair();
    const second = createPkcePair();
    expect(second.verifier).not.toBe(first.verifier);
    expect(second.challenge).not.toBe(first.challenge);
  });

  it('derives the challenge as the verifier’s own SHA-256 digest, measured independently', () => {
    const { verifier, challenge } = createPkcePair();
    const expectedChallenge = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expectedChallenge);
  });

  it('never lets the challenge equal the verifier — the plain method is not offered', () => {
    const { verifier, challenge } = createPkcePair();
    expect(challenge).not.toBe(verifier);
  });
});
