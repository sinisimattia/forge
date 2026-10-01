import { BadRequestException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { MfaMethodId, MfaProof } from '__FORGE_SCOPE__/core/mfa/types';
import { validationMessage } from '../../common/i18n';

/**
 * A fresh proof of a second factor, as it travels in a request body.
 *
 * Three optional fields, and **which are populated is the discriminator**: a
 * `recoveryCode` is a recovery code, and a `methodId` with a `code` is a method's
 * code. Nothing reads a value to decide which it is. See {@link proofOf} for how
 * the three collapse into core's `MfaProof`.
 */
export class MfaProofDto {
  /** The confirmed method the `code` was generated for. */
  @IsOptional()
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  methodId?: string;

  /** The code that method's authenticator is showing now. */
  @IsOptional()
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  code?: string;

  /** One of the account's own unused recovery codes. */
  @IsOptional()
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  recoveryCode?: string;
}

/**
 * Turns a body into a proof, or into `null` when it carries none.
 *
 * - No field at all is `null`: the caller offered no proof, and what that costs
 *   is the service's decision (`MfaReauthenticationRequiredError` when one is owed).
 * - `recoveryCode` alone, or `methodId` with `code` alone, is that proof.
 * - Anything else — both kinds at once, or half of a method proof — is a
 *   malformed request and is refused as one, rather than resolved by guessing
 *   which the caller meant.
 *
 * @throws BadRequestException for a body that is neither empty nor exactly one proof
 */
export function proofOf(body: MfaProofDto): MfaProof | null {
  const { methodId, code, recoveryCode } = body;
  const hasMethodProof = methodId !== undefined && code !== undefined;
  const hasRecoveryProof = recoveryCode !== undefined;
  const hasAny = methodId !== undefined || code !== undefined || hasRecoveryProof;

  if (!hasAny) return null;
  if (hasRecoveryProof && methodId === undefined && code === undefined) return { recoveryCode };
  if (hasMethodProof && !hasRecoveryProof) return { methodId: methodId as MfaMethodId, code };
  throw new BadRequestException('A proof is either a recoveryCode, or a methodId with its code.');
}

/**
 * {@link proofOf} for a proof that rides *inside* another request's body, as an
 * optional `proof` property, because the outer body already uses `methodId` and
 * `code` for something else.
 *
 * Absent is `null`, exactly as an empty body is for {@link proofOf}.
 *
 * @throws BadRequestException for a `proof` that is neither empty nor exactly one proof
 */
export function nestedProofOf(proof: MfaProofDto | undefined): MfaProof | null {
  return proof === undefined ? null : proofOf(proof);
}
