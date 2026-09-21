import { IsEmail, IsEnum, IsString } from 'class-validator';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { validationMessage } from '../../common/i18n';

/**
 * What a caller must supply to invite somebody into an organization.
 *
 * Only the cheap checks live here — a well-formed address, a role this
 * deployment's enum recognizes. The deeper rule — that the address may not
 * already belong to a member — is `OrganizationsService`'s own invariant,
 * enforced against the membership set a DTO cannot see, the same division
 * `ChangeMemberRoleDto` draws for the last-owner rule.
 */
export class InviteMemberDto {
  /** The address the invitation is addressed to. */
  @IsString({ message: validationMessage('validation.IS_STRING') })
  @IsEmail({}, { message: validationMessage('validation.IS_EMAIL') })
  readonly email!: string;

  /** The role the invitation offers, once accepted. */
  @IsEnum(OrgRole, { message: validationMessage('validation.IS_ENUM') })
  readonly role!: OrgRole;
}
