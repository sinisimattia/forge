import { IsEnum } from 'class-validator';
import { UserStatus } from '__FORGE_SCOPE__/core/users/enums';

/**
 * The standing an administrator gives an account.
 *
 * Validated against core's enum rather than against a list written here. A
 * second list is a list that stops matching the day somebody adds a member, and
 * the failure is that the new member is refused by validation for reasons no
 * error message explains.
 */
export class SetStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}
