import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Query, UseGuards } from '@nestjs/common';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { CurrentUser } from '../auth/decorators';
import { PermissionsGuard, RequirePermission } from '../authorization';
import type { AuthenticatedActor } from '../auth/strategies';
import { ParseUuidParamPipe } from '../common/pipes';
import type { PaginatedResponse } from '../common/types';
import {
  ChangeMemberRoleDto,
  ListMembersQueryDto,
  type MemberResponseDto,
} from './dto';
import { OrganizationsService } from './organizations.service';

/**
 * The memberships of one organization: who belongs to it, what role each
 * one holds, and how a membership ends.
 *
 * Mounted under `/organizations/:id/members`, a separate controller from
 * `OrganizationsController` for the same reason `IdentitiesController` is
 * separate from `UsersController` — a distinct resource under a path that
 * says what it is, rather than every route this backend serves living on one
 * class.
 *
 * **Nothing here is `@Public()`**, and every route carries
 * `@UseGuards(PermissionsGuard)` with the permission it requires. The guard
 * judges the ORGANIZATION named by `:id`, resolved from its stored row, and
 * never the `:userId` the request also names — who the target is stays the
 * service's question (a target outside the organization is
 * `MembershipNotFoundError`), and folding it in here would be the same rule
 * stated twice.
 *
 * ## Route order
 *
 * `:id` (the organization) and `:userId` (the member) are on different path
 * segments, so there is no ordering hazard here of the kind `UsersController`
 * has to guard against with `me` — no static segment on this controller
 * could ever be mistaken for either parameter.
 */
@Controller('organizations/:id/members')
export class MembersController {
  public constructor(private readonly organizations: OrganizationsService) {}

  /** One page of an organization's memberships. */
  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission('member:read')
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Query() query: ListMembersQueryDto,
  ): Promise<PaginatedResponse<MemberResponseDto>> {
    const page = await this.organizations.listMembers(
      actor.userId,
      organizationId as OrganizationId,
      { page: query.page, limit: query.limit, role: query.role },
    );
    return { data: page.data.map((membership) => membership.toJSON()), meta: page.meta };
  }

  /**
   * Gives a member a different role.
   *
   * Refusing to leave the organization with no OWNER answers 409 — see
   * `LastOwnerError`'s entry in `HttpExceptionFilter`'s `DOMAIN_ERRORS` table
   * for why that status and not another.
   */
  @Patch(':userId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('member:update')
  public async changeRole(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Param('userId', ParseUuidParamPipe) userId: string,
    @Body() body: ChangeMemberRoleDto,
  ): Promise<MemberResponseDto> {
    const membership = await this.organizations.changeMemberRole(
      actor.userId,
      organizationId as OrganizationId,
      userId as UserId,
      body.role,
    );
    return membership.toJSON();
  }

  /** Ends a membership. The account itself is untouched. */
  @Delete(':userId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('member:remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Param('userId', ParseUuidParamPipe) userId: string,
  ): Promise<void> {
    await this.organizations.removeMember(
      actor.userId,
      organizationId as OrganizationId,
      userId as UserId,
    );
  }
}
