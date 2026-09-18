/**
 * The single definition of email identity in the domain.
 *
 * Two addresses are the same account when their normal forms are equal. Only
 * surrounding whitespace and letter case are normalized: the local part of an
 * address is case-sensitive by specification, but no provider in practice
 * treats it that way, and folding case here is what stops one person holding
 * two accounts that look identical. Anything more aggressive — stripping dots,
 * removing `+tags` — is provider-specific and would silently merge addresses
 * that are genuinely distinct elsewhere.
 *
 * @param raw - an address as a person typed it
 * @returns the normal form used for storage, lookup and uniqueness
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
