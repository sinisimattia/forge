import type { OrganizationJSON } from '__FORGE_SCOPE__/core/organizations/types';

/**
 * An organization, as every caller of this backend is shown it.
 *
 * **An alias for core's wire shape, not an interface that happens to match
 * one.** See `UserResponseDto` for why: there is nowhere on this type to put
 * a field that `Organization.toJSON` does not already produce, so nothing
 * here can drift from what `Organization.fromJSON` — the webapp's own
 * reviver — knows how to read back.
 */
export type OrganizationResponseDto = OrganizationJSON;

/**
 * The alias, enforced by the compiler. See `UserResponseDto`'s twin for what
 * this catches: an optional extra field on this type populates nothing at
 * runtime and would otherwise be invisible to every test in this backend.
 */
type ExtraKeys = Exclude<keyof OrganizationResponseDto, keyof OrganizationJSON>;
type NoExtraKeys = [ExtraKeys] extends [never] ? true : never;
export const ORGANIZATION_WIRE_SHAPE_HAS_NO_FIELDS_OF_ITS_OWN: NoExtraKeys = true;
