import type { UserJSON } from '__FORGE_SCOPE__/core/users/types';

/**
 * A person, as every caller of this backend is shown them.
 *
 * **An alias for core's wire shape, not an interface that happens to match
 * one.** It is written this way so that there is nowhere to put a field: the
 * webapp parses this payload with `User.fromJSON`, which re-runs every invariant
 * and knows exactly the ten keys core defines, so a field added on this side is
 * a field the other side drops — silently, and only for whoever added it.
 *
 * The alias is also what makes the absence of secret material structural rather
 * than careful. `User` has no field a derivation could live in (ADR-0005) and
 * `User.toJSON` serializes what `User` has, so there is no redaction step here
 * for anybody to forget to maintain. B9's grep over the generated project exists
 * to catch a regression of exactly that kind.
 *
 * If a response genuinely needs more than a user — a flag about the request
 * being served, the way `SessionResponseDto.isCurrent` does — it goes in a type
 * that *contains* one of these, never in this one.
 */
export type UserResponseDto = UserJSON;
