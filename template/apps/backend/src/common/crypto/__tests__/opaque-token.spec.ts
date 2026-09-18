import { createHash } from 'node:crypto';
import { generateOpaqueToken } from '../generateOpaqueToken';
import { hashOpaqueToken } from '../hashOpaqueToken';

describe('generateOpaqueToken', () => {
  it('carries at least 32 bytes drawn from the CSPRNG', () => {
    const { token } = generateOpaqueToken();

    // Decoded length, not string length: base64url expands 32 bytes to 43
    // characters, so asserting the string is "at least 32 long" would still pass
    // on a 24-byte credential.
    //
    // What this checks is a byte COUNT, and a byte count is not entropy — the
    // name says "drawn from the CSPRNG" rather than "32 bytes of entropy"
    // because it is the source, not this assertion, that makes those bytes
    // unguessable. Three facts together carry the real claim, and each is
    // asserted somewhere: the bytes come from `randomBytes` (the
    // "does not repeat itself" case below fails for any fixed source), there are
    // at least 32 of them (here), and the encoding is injective so all of them
    // survive into the credential (the base64url case below, which pins the
    // length and so rejects an encoding that has silently changed).
    expect(Buffer.from(token, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  it('is base64url, so it needs no further encoding in a URL, header or log line', () => {
    const { token } = generateOpaqueToken();

    // The alphabet alone does not pin the encoding: hex uses a SUBSET of the
    // base64url alphabet, so `.toString('hex')` satisfies the regex, and it
    // decodes as 48 base64url bytes so it satisfies the byte-count case above
    // too. The length is what discriminates — 32 bytes is 43 base64url
    // characters, 64 hex characters, or 44 standard-base64 characters with
    // padding. Asserting both is what makes this test about the encoding rather
    // than about the alphabet.
    //
    // 43 is exact on purpose, and it therefore also breaks if the credential is
    // made LONGER. That is the same trade the hasher suite makes by writing its
    // cost parameters out as literals: changing how much is drawn is a decision,
    // and a decision should have to walk past a red test rather than slip
    // through a `>=`. Deriving the expected length from the decoded byte count
    // instead would defeat the purpose — 64 hex characters decode to 48 bytes,
    // which re-encode to 64 characters, so a self-consistent check passes hex.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).toHaveLength(43);
  });

  it('does not repeat itself', () => {
    const drawn = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken().token));

    expect(drawn.size).toBe(1000);
  });

  it('returns the digest of the credential it returned beside it', () => {
    const { token, hash } = generateOpaqueToken();

    expect(hash).toBe(hashOpaqueToken(token));
  });

  it('returns a digest and not the credential', () => {
    const { token, hash } = generateOpaqueToken();

    // The real assertion is the independent recomputation in the suite below:
    // it is what fails if this ever returns the credential itself, or a digest
    // of something else. This one states the consequence that matters — what is
    // persisted is not a working credential — and it is admittedly weak on its
    // own, because two unrelated 43-character strings would not match either.
    expect(hash).not.toBe(token);
  });
});

describe('hashOpaqueToken', () => {
  it('is SHA-256, base64url-encoded', () => {
    const { token } = generateOpaqueToken();

    // Computed here from `node:crypto` directly rather than compared against
    // anything the module exports. This is the assertion that fails if the
    // digest is ever changed to SHA-1, to a truncation, to hex, or to a slow
    // password derivation — none of which any other test in this file would
    // notice, because every one of those still returns a distinct string.
    expect(hashOpaqueToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('base64url'));
  });

  it('is a function of the credential alone, so a lookup by digest finds the row', () => {
    // A digest that depended on anything but its input — a per-call salt, a
    // clock — would make the stored value unfindable. This is what makes storing
    // only the digest workable, so it is worth stating rather than assuming.
    const { token } = generateOpaqueToken();

    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it('gives different credentials different digests', () => {
    expect(hashOpaqueToken('a')).not.toBe(hashOpaqueToken('b'));
  });
});
