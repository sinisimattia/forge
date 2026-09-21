import { createHash, randomBytes } from 'node:crypto';

/** Bytes drawn for the verifier. Base64url-encoded, 32 bytes becomes 43 characters. */
const VERIFIER_BYTES = 32;

/** A PKCE verifier and the challenge derived from it. */
export interface PkcePair {
  /** Kept on this server only — see `oauth_authorization_requests.code_verifier`. */
  readonly verifier: string;
  /** Sent to the provider as `code_challenge`. */
  readonly challenge: string;
}

/**
 * A PKCE verifier and its challenge.
 *
 * The verifier is 32 random bytes from the platform CSPRNG, base64url-encoded
 * — 43 characters, inside RFC 7636's 43–128 range. The challenge is its
 * SHA-256 digest, base64url, which is the `S256` method.
 *
 * **Only `S256` is offered, and `plain` must never be added here.** Under
 * `plain` the challenge *is* the verifier, so anyone who intercepts the
 * authorization request — the one leg of this flow that travels through a
 * browser, a redirect chain and a provider's own access logs — holds
 * everything needed to complete the token exchange themselves. That is
 * exactly the theft PKCE exists to make useless: it works only because the
 * value the provider is shown (the challenge) cannot be turned back into the
 * value redeemed at the token endpoint (the verifier), and `plain` throws
 * that property away.
 *
 * @returns a fresh, unrelated verifier and challenge pair
 */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(VERIFIER_BYTES).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
