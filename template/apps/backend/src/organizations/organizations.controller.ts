import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { CurrentUser } from '../auth/decorators';
import type { AuthenticatedActor } from '../auth/strategies';
import type { PaginatedResponse } from '../common/types';
import { ParseUuidParamPipe } from '../common/pipes';
import {
  CreateOrganizationDto,
  ListOrganizationsQueryDto,
  UpdateOrganizationDto,
  type OrganizationResponseDto,
} from './dto';
import { OrganizationsService } from './organizations.service';

/**
 * An organization, and the ones the caller belongs to.
 *
 * **Nothing here is `@Public()`.** The global guard closes every route by
 * default and every one of these is about a particular organization, so
 * there is nothing to open. **Nothing here is guarded by `PermissionsGuard`
 * either** — every route is authenticated but not yet authorized. That is
 * Task 13's own pass over every route Tasks 10–12 add, made once rather than
 * bolted on route by route as each module lands.
 *
 * ## Route order
 *
 * Every path parameter here is `:id`, and no static segment on this
 * controller could ever be mistaken for one — unlike `UsersController`,
 * which has to declare `me` ahead of `:id` for exactly that reason. `POST
 * /organizations` and `GET /organizations` take no parameter at all, so there
 * is no ordering hazard on this controller to protect against.
 */
@Controller('organizations')
export class OrganizationsController {
  public constructor(private readonly organizations: OrganizationsService) {}

  /** Creates an organization. The caller becomes its OWNER. */
  @Post()
  public async create(
    @CurrentUser() actor: AuthenticatedActor,
    @Body() body: CreateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    const organization = await this.organizations.createOrganization(actor.userId, {
      name: body.name,
      slug: body.slug,
    });
    return organization.toJSON();
  }

  /** One page of the organizations the caller belongs to. */
  @Get()
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
    @Query() query: ListOrganizationsQueryDto,
  ): Promise<PaginatedResponse<OrganizationResponseDto>> {
    const page = await this.organizations.listOrganizations(actor.userId, {
      page: query.page,
      limit: query.limit,
    });
    return { data: page.data.map((organization) => organization.toJSON()), meta: page.meta };
  }

  /** One organization the caller belongs to. */
  @Get(':id')
  public async byId(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
  ): Promise<OrganizationResponseDto> {
    const organization = await this.organizations.getOrganization(
      actor.userId,
      id as OrganizationId,
    );
    return organization.toJSON();
  }

  /** Changes an organization's name, its slug, or both. */
  @Patch(':id')
  public async update(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
    @Body() body: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    const organization = await this.organizations.updateOrganization(
      actor.userId,
      id as OrganizationId,
      {
        // Field by field rather than passing the body: `UpdateOrganizationInput`
        // is core's shape and this DTO is the wire's, and the day they differ
        // the compiler must say so here rather than a field crossing that
        // nothing on the domain side declared.
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.slug === undefined ? {} : { slug: body.slug }),
      },
    );
    return organization.toJSON();
  }

  /** Soft-deletes an organization. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
  ): Promise<void> {
    await this.organizations.deleteOrganization(actor.userId, id as OrganizationId);
  }
}
