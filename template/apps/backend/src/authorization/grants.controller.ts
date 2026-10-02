import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { GrantId, Permission } from '__FORGE_SCOPE__/core/authorization/types';
import type { ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { CurrentUser } from '../auth/decorators';
import type { AuthenticatedActor } from '../auth/strategies';
import { ParseUuidParamPipe } from '../common/pipes';
import type { PaginatedResponse } from '../common/types';
import { AuthorizationService } from './authorization.service';
import { CreateGrantDto, ListGrantsQueryDto, toGrantResponse, type GrantResponseDto } from './dto';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermission } from './require-permission.decorator';

/**
 * The record-level exceptions of one organization: issuing them, listing
 * them, withdrawing them.
 *
 * Mounted under `/organizations/:id/grants`, the same shape `MembersController`
 * takes and for the same reason — a distinct resource, its own path, its own
 * controller. Every route carries `@UseGuards(PermissionsGuard)`: layer two
 * decides who may *administer* a grant (`grant:read`, `grant:create`,
 * `grant:revoke`, all organization-scoped — see `Permission`'s own TSDoc),
 * and that is a different question from what a grant, once issued, goes on to
 * decide.
 *
 * **No route here ever asks `can` about a `resourceType`/`resourceId`.**
 * `PermissionsGuard` resolves only the organization named by `:id`, exactly as
 * it does for every other controller it protects — see that guard's own TSDoc
 * for why naming the organization itself as the resource would turn an
 * ADMIN's `grant:create` into a route to `organization:delete`. Layer three is
 * administered here and consulted on no route in this application; that is
 * `can`'s own documented state, not a gap this controller is failing to close.
 */
@Controller('organizations/:id/grants')
export class GrantsController {
  public constructor(private readonly authorization: AuthorizationService) {}

  /** One page of an organization's grants. */
  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission('grant:read')
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Query() query: ListGrantsQueryDto,
  ): Promise<PaginatedResponse<GrantResponseDto>> {
    const page = await this.authorization.listGrants(
      actor.userId,
      organizationId as OrganizationId,
      { page: query.page, limit: query.limit },
    );
    return { data: page.data.map((grant) => toGrantResponse(grant)), meta: page.meta };
  }

  /**
   * Issues a grant.
   *
   * @throws BadRequestException (400) when `body.permission` is
   * `'platform:administer'` — see `AuthorizationService.createGrant`'s own
   * TSDoc.
   * @throws CrossTenantGrantError (409) when the subject is not a member of
   * this organization.
   */
  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission('grant:create')
  public async create(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Body() body: CreateGrantDto,
  ): Promise<GrantResponseDto> {
    const grant = await this.authorization.createGrant(
      actor.userId,
      organizationId as OrganizationId,
      {
        subjectUserId: body.subjectUserId as UserId,
        resourceType: body.resourceType as ResourceType,
        resourceId: body.resourceId,
        permission: body.permission as Permission,
        expiresAt: body.expiresAt ?? null,
      },
    );
    return toGrantResponse(grant);
  }

  /** Withdraws a grant. `204`, the same answer `MembersController.remove` gives. */
  @Delete(':grantId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('grant:revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async revoke(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Param('grantId', ParseUuidParamPipe) grantId: string,
  ): Promise<void> {
    await this.authorization.revokeGrant(
      actor.userId,
      organizationId as OrganizationId,
      grantId as GrantId,
    );
  }
}
