import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/**
 * One attempt to finish a sign-in that the password alone did not finish.
 *
 * **`methodId` is validated as a non-empty string and not as a UUID**, for the
 * reason `LoginDto.email` is validated as a string and not as an address. An
 * `@IsUUID` here would answer a malformed id with a `422` carrying a
 * field-level detail, and a well-formed id belonging to somebody else with the
 * `401` this route gives every refusal — two distinguishable answers on an
 * endpoint whose whole design is that every failure looks the same.
 *
 * **What makes that safe is not that a malformed id matches no row.** It does
 * not: `mfa_methods.id` is a `uuid` column, so Postgres answers
 * `findOne({ where: { id: 'not-a-uuid' } })` with `22P02 invalid input syntax
 * for type uuid`, which reaches the transport as a `QueryFailedError` and is
 * answered `500` — a sixth answer on the one route built so that every refusal
 * is byte-identical, and one that spends the challenge on the way. This comment
 * claimed the opposite until the shape check existed to make it true.
 *
 * What makes it safe is that `MfaVerificationService.completeLogin` checks the
 * id's **shape before the lookup** and refuses a malformed one with
 * `MfaMethodNotFoundError` — the same error, and so the same `401` and the same
 * body, as an id that is well-formed and answers to nothing.
 *
 * ## Which proof it is: the field, and only the field
 *
 * `methodId` and `code` together are a method's code; `recoveryCode` alone is a
 * recovery code. **None of the three is required by validation**, on purpose:
 * a request with both proofs, or with neither, is answered by
 * `AuthController.verifyMfa` with the same `401` as every other refusal, and a
 * `422` here would be a distinguishable seventh answer on the route built so
 * that there is exactly one. A field that is present but not a non-empty
 * string is still a `422`, as a wrongly typed field always was.
 *
 * The fields are separate rather than one opaque blob because they are
 * different things with different origins: the challenge is this server's own
 * minted value, the method id is a selection among what the challenge response
 * offered, the code is what the person read off their authenticator, and the
 * recovery code is what they kept on paper.
 */
export class VerifyMfaDto {
  /** The challenge `POST /auth/login` returned. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  challengeToken!: string;

  /**
   * Which of the account's methods `code` is for. Present with `code`, absent
   * with `recoveryCode`.
   */
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  methodId?: string;

  /** The proof from that method, as the person typed it. */
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  code?: string;

  /**
   * One of the account's unused recovery codes, offered **instead of** a method
   * and a code.
   *
   * Its own field, so that which proof this is comes from which field the
   * caller populated and never from what the string looks like.
   */
  @ValidateIf((_, value) => value !== undefined)
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  recoveryCode?: string;
}
