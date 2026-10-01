import { Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { validationMessage } from '../../common/i18n';
import { MfaProofDto } from './mfa-proof.dto';

/** The proof that finishes an enrollment: a code from the app that scanned the offer. */
export class ConfirmTotpDto {
  /** The `methodId` the enrollment offer carried. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  methodId!: string;

  /** The code the person's app is showing, as they typed it. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  code!: string;

  /**
   * A fresh proof of a second factor the account **already holds**. Owed only
   * when the account already has a confirmed method, and absent for its first.
   *
   * Nested rather than flattened into this body because `methodId` and `code`
   * above are the *new* method's; a proof's own `methodId` and `code` name a
   * different method and would collide with them.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => MfaProofDto)
  proof?: MfaProofDto;
}
