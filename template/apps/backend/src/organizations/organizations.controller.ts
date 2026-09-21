import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import { CurrentUser } from '../auth/decorators';
import { PermissionsGuard, RequirePermission } from '../authorization';
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
 * there is nothing to open.
 *
 * ## Which routes carry `@RequirePermission`, and which do not
 *
 * The three that name an organization do; `POST /organizations` and `GET
 * /organizations` do not, and their absence is a decision rather than an
 * omission. Neither is about an existing organization: the first creates one
 * and makes the caller its OWNER, so there is no tenant to judge it against
 * and no principal that could hold a role in a thing that does not exist yet;
 * the second is already confined to the caller's own memberships by
 * `OrganizationsService.listOrganizations`, which is tenant scoping done by
 * the read rather than by a refusal. Both remain closed to an unauthenticated
 * caller by the global `JwtAuthGuard`.
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

  /**
   * One organization the caller belongs to.
   *
   * **This guard is the one on this controller that no test can catch the
   * deletion of, and that is stated here rather than papered over with an
   * assertion that cannot fail.** Every `OrgRole` carries `organization:read` —
   * it is what belonging means — so on this route the guard and
   * `OrganizationsService.requireMember` agree for every actor there is: a
   * member is allowed by both, a non-member refused by both, with the same
   * status and the same body. There is no observable fault to assert, and a test
   * written to cover this line would pass with the line deleted, which is worse
   * than the gap because it reports the opposite of the truth.
   *
   * The annotation is here for what it declares, not for what it currently
   * refuses: the day a role is added that does not carry `organization:read`,
   * this route already says what it requires. Its two siblings are asserted —
   * see `__tests__/organizations.controller.spec.ts`'s `authorization:` block.
   */
  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermission('organization:read')
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
  @UseGuards(PermissionsGuard)
  @RequirePermission('organization:update')
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
  @UseGuards(PermissionsGuard)
  @RequirePermission('organization:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async remove(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) id: string,
  ): Promise<void> {
    await this.organizations.deleteOrganization(actor.userId, id as OrganizationId);
  }
}
