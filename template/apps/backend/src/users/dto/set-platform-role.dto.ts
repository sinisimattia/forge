import { IsEnum } from 'class-validator';
import { PlatformRole } from '__FORGE_SCOPE__/core/users/enums';

/** The platform standing an administrator gives an account. */
export class SetPlatformRoleDto {
  @IsEnum(PlatformRole)
  platformRole!: PlatformRole;
}
