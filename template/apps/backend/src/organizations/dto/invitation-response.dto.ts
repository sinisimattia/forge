import type { InvitationJSON } from '__FORGE_SCOPE__/core/organizations/types';

/**
 * An invitation, as every caller of this backend is shown it.
 *
 * **An alias for core's wire shape, not an interface that happens to match
 * one.** See `OrganizationResponseDto` for why: there is nowhere on this
 * type to put a field that `Invitation.toJSON` does not already produce —
 * in particular no field for the token, which `Invitation` has none of
 * either (see `InvitationRecord`'s own TSDoc). Nothing here can drift from
 * what `Invitation.fromJSON` knows how to read back.
 */
export type InvitationResponseDto = InvitationJSON;

/**
 * The alias, enforced by the compiler. See `OrganizationResponseDto`'s twin
 * for what this catches: an optional extra field on this type populates
 * nothing at runtime and would otherwise be invisible to every test in this
 * backend.
 */
type ExtraKeys = Exclude<keyof InvitationResponseDto, keyof InvitationJSON>;
type NoExtraKeys = [ExtraKeys] extends [never] ? true : never;
export const INVITATION_WIRE_SHAPE_HAS_NO_FIELDS_OF_ITS_OWN: NoExtraKeys = true;
