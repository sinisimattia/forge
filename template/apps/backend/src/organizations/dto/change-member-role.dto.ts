import { IsEnum } from 'class-validator';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import { validationMessage } from '../../common/i18n';

/**
 * What a caller must supply to change a member's role.
 *
 * The deeper rule — that this change may not leave the organization with no
 * OWNER — is `OrganizationsService`'s own invariant, enforced once against a
 * count read inside the write's transaction (spec §9.4, D15). A DTO cannot
 * see the rest of the membership set, so it is not this class's business to
 * try.
 */
export class ChangeMemberRoleDto {
  /** The role the member is to hold. */
  @IsEnum(OrgRole, { message: validationMessage('validation.IS_ENUM') })
  readonly role!: OrgRole;
}
