import type { MembershipJSON } from '__FORGE_SCOPE__/core/organizations/types';

/**
 * A membership, as every caller of this backend is shown it.
 *
 * **An alias for core's wire shape, not an interface that happens to match
 * one.** See `OrganizationResponseDto` for why: there is nowhere on this
 * type to put a field that `Membership.toJSON` does not already produce, so
 * nothing here can drift from what `Membership.fromJSON` knows how to read
 * back.
 */
export type MemberResponseDto = MembershipJSON;

/**
 * The alias, enforced by the compiler. See `OrganizationResponseDto`'s twin
 * for what this catches: an optional extra field on this type populates
 * nothing at runtime and would otherwise be invisible to every test in this
 * backend.
 */
type ExtraKeys = Exclude<keyof MemberResponseDto, keyof MembershipJSON>;
type NoExtraKeys = [ExtraKeys] extends [never] ? true : never;
export const MEMBER_WIRE_SHAPE_HAS_NO_FIELDS_OF_ITS_OWN: NoExtraKeys = true;
