import { randomBytes } from 'node:crypto';
import { hashOpaqueToken } from './hashOpaqueToken';

/** Bytes drawn per credential. 256 bits: far beyond any guessing budget. */
const TOKEN_BYTES = 32;

/**
 * A single-use credential and the value stored in its place.
 *
 * 32 bytes from the platform CSPRNG, base64url-encoded. The caller hands `token`
 * to its holder and persists only `hash`, so a copy of the table is not a set of
 * working credentials. The digest is a plain SHA-256 rather than a password
 * derivation: the input is full-entropy and uniformly random, so there is no
 * guessing to slow down, and a slow digest here would tax every issue and every
 * refresh for nothing. See {@link hashOpaqueToken}.
 *
 * @returns the credential to hand out, and the digest to store
 */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}
