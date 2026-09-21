import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { validationMessage } from '../../common/i18n';

/**
 * What a caller must supply to issue a grant.
 *
 * `resourceType` and `permission` are validated only as non-empty strings, not
 * against a closed set. Core's own `ResourceType` is deliberately an
 * unvalidated branded string — "the deployment's own noun, never enumerated by
 * core" (`ResourceType`'s own TSDoc) — so there is nothing here to check it
 * against. `Permission` IS a checked union in core, but the union has no
 * runtime representation this DTO could validate against without hand-copying
 * core's own literal list into this package and letting the copy go stale the
 * next time the union grows a member — the exact hazard `DOMAIN_ERROR_CODES`
 * is written to avoid one file over. The one member this endpoint must never
 * accept, `platform:administer`, is a single named literal and is refused by
 * `AuthorizationService.createGrant` itself — see that method's own TSDoc for
 * why it lives there and not here.
 *
 * Neither the organization nor the issuer appears here, for the reason core's
 * `CreateGrantInput` gives on itself: both are established independently of
 * whatever a caller's body says — the organization from the route, the issuer
 * from the credential.
 */
export class CreateGrantDto {
  /** The person the grant is for. They must already be a member of the organization. */
  @IsUUID(undefined, { message: validationMessage('validation.IS_UUID') })
  readonly subjectUserId!: string;

  /** What kind of record it is about. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  readonly resourceType!: string;

  /** Which record. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  readonly resourceId!: string;

  /** The one thing the subject may do to it. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsNotEmpty({ message: validationMessage('validation.IS_NOT_EMPTY') })
  readonly permission!: string;

  /**
   * When it lapses. Omitted or `null` issues a grant that does not lapse —
   * the same deliberate choice `CreateGrantInput.expiresAt` documents on
   * itself.
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: validationMessage('validation.IS_DATE') })
  readonly expiresAt?: Date | null;
}
