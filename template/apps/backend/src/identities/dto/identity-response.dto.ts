import type { AuthIdentityJSON } from '__FORGE_SCOPE__/core/identities/types';

/**
 * One way a person can prove who they are, as they are shown it.
 *
 * An alias for core's wire shape, for the reason `UserResponseDto` is one:
 * there is nowhere to put a field, so the webapp's `AuthIdentity.fromJSON`
 * parses exactly what this emits.
 *
 * The whole of core's `AuthIdentity` is safe to return, structurally: the entity
 * has no field a derivation, a salt or a cost parameter could live in
 * (ADR-0005), and the three columns that hold them exist only on
 * `AuthIdentityRecord`. That is what makes a "ways you can sign in" screen
 * possible with no redaction step for anybody to forget to maintain — and the
 * conformance suite asserts the emitted key set, so adding one fails a test
 * rather than shipping.
 */
export type IdentityResponseDto = AuthIdentityJSON;

/** The same compiler-enforced alias `UserResponseDto` carries; see it for why. */
type ExtraKeys = Exclude<keyof IdentityResponseDto, keyof AuthIdentityJSON>;
type NoExtraKeys = [ExtraKeys] extends [never] ? true : never;
export const IDENTITY_WIRE_SHAPE_HAS_NO_FIELDS_OF_ITS_OWN: NoExtraKeys = true;
