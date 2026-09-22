/**
 * The single definition of "shaped like an email address" in the domain.
 *
 * Deliberately shallow: exactly one `@`, something either side, no
 * whitespace. Anything stricter rejects addresses that are legal and in use;
 * the only real proof that an address exists is that someone received a
 * message at it, which is what verification is for.
 *
 * Extracted so every path that can mint a stored address — `User`'s own
 * constructor, and any policy deciding whether a provider's assertion may
 * become one — shares one rule rather than each trusting its input on its
 * own terms.
 *
 * @param value - a candidate address, already in normal form
 * @returns whether the value could be an address at all
 */
export function looksLikeAnAddress(value: string): boolean {
  const parts = value.split('@');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' && !/\s/.test(value);
}
