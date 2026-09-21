import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { AuditEntryJSON } from '__FORGE_SCOPE__/core/audit/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { CurrentUser } from '../auth/decorators';
import type { AuthenticatedActor } from '../auth/strategies';
import { PermissionsGuard, RequirePermission } from '../authorization';
import { ParseUuidParamPipe } from '../common/pipes';
import type { PaginatedResponse } from '../common/types';
import { AuditService } from './audit.service';

/**
 * How a caller asks for one page of ONE organization's history.
 *
 * The same filters `AuditQueryDto` declares, plus `organizationId` — which
 * this route's own tenant, taken from `:id`, always wins over. **That field
 * is accepted here on purpose, not by oversight.** Whitelisting it is what
 * makes the vulnerability this endpoint must resist a real, reachable one
 * rather than a hypothetical closed off by validation: a caller CAN send
 * `?organizationId=<another tenant>` over the wire, exactly as
 * `OrganizationAuditController.list`'s own conflicting-filter test does, and
 * the property under test is that it changes nothing. Declaring the field
 * and then discarding it is a stronger claim than never accepting it at all.
 */
export class OrganizationAuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly limit: number = 20;

  /** Only entries this person is recorded as the actor of. */
  @IsOptional()
  @IsUUID()
  readonly actorId?: string;

  /** Only entries recording this kind of action. */
  @IsOptional()
  @IsEnum(AuditAction)
  readonly action?: AuditAction;

  /** Only entries that had already happened at this instant. See `AuditQueryDto.asOf`. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  readonly asOf?: Date;

  /**
   * Whatever tenant the caller names here is discarded. See this class's own
   * TSDoc, and `OrganizationAuditController.list`'s comment on why the field
   * is read from the route and not from this one.
   */
  @IsOptional()
  @IsUUID()
  readonly organizationId?: string;
}

/**
 * Reading one organization's own history — the organization-scoped half of
 * spec §9.6, `GET /audit`'s cross-tenant read being the other. Mounted under
 * `/organizations/:id/audit`, guarded by `PermissionsGuard` and
 * `audit:read` exactly as `GrantsController`'s three routes are, rather than
 * by `PlatformAdminGuard`: this route is for an organization's OWN
 * administrators, not for the deployment's.
 *
 * **This is a separate surface from `AuditController`, not a widened one.**
 * `GET /audit` stays exactly as narrow as Task 12 left it — closed to
 * everybody but a platform administrator, by `PlatformAdminGuard`, which
 * answers a non-administrator 404 whatever role they hold in whatever
 * organization. `organization-audit.controller.spec.ts` asserts that
 * directly: an organization ADMIN reaching `GET /audit` still gets that 404.
 */
@Controller('organizations/:id/audit')
export class OrganizationAuditController {
  public constructor(private readonly audit: AuditService) {}

  /**
   * One page of one organization's history, newest first.
   *
   * ## Why the route's organization is written LAST
   *
   * `query.organizationId` is spread in from the caller's own filter FIRST,
   * and the route's own `organizationId` is written into the object SECOND —
   * after, and therefore winning. **That order is the entire content of this
   * route's tenant isolation**, and it is deliberately not a hopeful
   * convention: `AuditService.queryForOrganization` trusts `query.organizationId`
   * completely, with no separate parameter to fall back on (see that method's
   * own TSDoc), so whichever value survives the object literal below is the
   * value that decides both the store's `WHERE` and the actor's permission
   * check. Writing the route's key first and the caller's spread after would
   * let a caller's own `organizationId` — naming any OTHER tenant — silently
   * overwrite it again, which is exactly the fault
   * `organization-audit.controller.spec.ts`'s conflicting-filter test is built
   * to catch: it supplies `organizationId` naming a DIFFERENT organization
   * from the route's and asserts every entry that comes back belongs to the
   * route's tenant regardless.
   *
   * @param actor - who is asking, as the guard's strategy established them
   * @param organizationId - the tenant this route names, resolved from `:id`
   * @param query - which page is wanted, and how to narrow it — except for
   * `organizationId`, which this route decides
   * @returns the page, with the totals a caller needs
   */
  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermission('audit:read')
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('id', ParseUuidParamPipe) organizationId: string,
    @Query() query: OrganizationAuditQueryDto,
  ): Promise<PaginatedResponse<AuditEntryJSON>> {
    const page = await this.audit.queryForOrganization(actor.userId, {
      page: query.page,
      limit: query.limit,
      ...(query.asOf === undefined ? {} : { asOf: query.asOf }),
      ...(query.actorId === undefined ? {} : { actorId: query.actorId as UserId }),
      ...(query.action === undefined ? {} : { action: query.action }),
      // THE CALLER'S OWN FILTER, spread first — a caller-supplied
      // `organizationId` lands here if this key were the last one written.
      ...(query.organizationId === undefined
        ? {}
        : { organizationId: query.organizationId as OrganizationId }),
      // THE ROUTE'S TENANT, written LAST. See this method's own doc comment:
      // this is the one line responsible for the caller never being able to
      // read another tenant's history through this route.
      organizationId: organizationId as OrganizationId,
    });

    return { data: page.data.map((entry) => entry.toJSON()), meta: page.meta };
  }
}
