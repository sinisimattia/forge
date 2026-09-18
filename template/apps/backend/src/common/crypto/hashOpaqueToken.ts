import { createHash } from 'node:crypto';

/**
 * The digest stored in place of a server-generated credential.
 *
 * A plain SHA-256, and that is the whole point rather than an omission. These
 * credentials are not passwords: the server draws them from a CSPRNG at full
 * entropy, so there is no guessing to slow down, and a deliberately slow
 * derivation here would buy nothing while taxing every issue and every refresh.
 * Passwords are the other case — chosen by people, low entropy, and needing a
 * slow derivation; that is {@link IPasswordHasher}, and using either of the two
 * in the other's place is wrong in both directions.
 *
 * The output is base64url so it is safe in a URL, a header and a log line
 * without further encoding, and so it is the same alphabet as the credential it
 * stands for.
 *
 * Callers look a credential UP by this digest and let the unique index decide
 * whether it exists. That is deliberate: there is then no comparison of two
 * secrets anywhere on the path, and so no secret-dependent branch whose timing
 * could be measured. Anything that ever does have to compare two secrets
 * directly must use `crypto.timingSafeEqual` instead of `===`.
 *
 * @param token - the credential as the holder presents it
 * @returns its digest, base64url-encoded
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}
