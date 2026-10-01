import type { MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';

/**
 * `GET /mfa/methods`'s answer.
 *
 * `recoveryCodesRemaining` is a fact about the account, so it is a sibling of
 * `methods` rather than a field of `MfaMethodJSON`, whose key set is pinned.
 * It is always present: an account with none left gets `0`, never an omitted
 * key, because a template that guards on the field cannot tell an omitted one from a zero.
 */
export interface MfaMethodsResponseDto {
  readonly methods: MfaMethodJSON[];
  readonly recoveryCodesRemaining: number;
}
