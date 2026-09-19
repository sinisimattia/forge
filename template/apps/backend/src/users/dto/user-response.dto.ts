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

/**
 * The alias, enforced by the compiler rather than by this file's prose.
 *
 * `npm run typecheck` fails the moment `UserResponseDto` names a key `UserJSON`
 * does not — including an **optional** one, which is why this is a key-set
 * comparison and not a mutual-assignability check. An optional extra field is
 * assignable in both directions and populates nothing at runtime, so it is
 * invisible to every test in this backend: injecting
 * `interface UserResponseDto extends UserJSON { secretHash?: string }` left all
 * 343 of them green. This line is what turns red.
 */
type ExtraKeys = Exclude<keyof UserResponseDto, keyof UserJSON>;
type NoExtraKeys = [ExtraKeys] extends [never] ? true : never;
export const WIRE_SHAPE_HAS_NO_FIELDS_OF_ITS_OWN: NoExtraKeys = true;
