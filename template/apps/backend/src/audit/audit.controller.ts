import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { AuditEntryJSON } from '__FORGE_SCOPE__/core/audit/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { PaginatedResponse } from '../common/types';
import { CurrentUser } from '../auth/decorators';
import { PlatformAdminGuard } from '../auth/guards';
import type { AuthenticatedActor } from '../auth/strategies';
import { AuditService } from './audit.service';

/**
 * How a caller asks for one page of the history.
 *
 * Declared here rather than reused from `common/types`'s `PaginationQueryDto`
 * because it adds filters; extending that class would work and is deliberately
 * not done, so that the fields this endpoint accepts are all visible in one
 * place. The global validation pipe runs with `forbidNonWhitelisted`, so a
 * filter that is not declared here is a 400 rather than a silently ignored
 * parameter.
 */
export class AuditQueryDto {
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
}

/**
 * Reading the deployment's history.
 *
 * One endpoint, and no others: `IAuditService` offers `record` and `query` and
 * nothing that could change an entry, and this controller offers less than that
 * — writing is something the application does on somebody's behalf, never
 * something a caller asks for directly.
 *
 * ## Reading this log appends to it, and that is not a mistake
 *
 * `PlatformAdminGuard` records a `PLATFORM_ADMIN_OVERRIDE` for every pass, so
 * every read of the history adds an entry to the history. Spec §9.5 requires
 * every platform-administrative pass to be logged and this is exactly such a
 * pass, so the entry is owed. Carving out an exception here — "except when the
 * thing being read is the log itself" — would be the one exception nobody
 * auditing the deployment would think to look for.
 *
 * **What it costs, stated so that nobody discovers it from a bug report.** Three
 * things, each asserted in `__tests__/audit.controller.spec.ts` rather than left
 * as prose:
 *
 * 1. The guard runs before the handler, so **a read's own entry is in the page
 *    that read returns**. The newest row of page 1 is always the request that
 *    asked for it.
 * 2. The page/limit window is an offset into a list ordered newest-first, and
 *    each read inserts a row at the top of that list, so an administrator
 *    reading page 1 and then page 2 **sees the last row of page 1 again** at the
 *    top of page 2 — once per intervening read. Nothing is wrong with the
 *    paging: offset paging over a table that is being appended to is unstable,
 *    and here the reader is the one appending.
 * 3. Anything that polls this endpoint writes to it at the polling rate, for
 *    ever, into a table nothing is permitted to prune.
 *
 * The fix is not a special case here. It is an upper bound on the window —
 * `AuditQuery` gaining an "as of this instant" field that every page of one
 * traversal shares — which makes the sequence stable against *any* concurrent
 * write and not only against the reader's own. That is a change to core's
 * contract and to `runIAuditServiceContract`, so it belongs to whoever next owns
 * that contract rather than to this file.
 */
@Controller('audit')
@UseGuards(PlatformAdminGuard)
export class AuditController {
  public constructor(private readonly audit: AuditService) {}

  /**
   * One page of the history, newest first.
   *
   * The guard above answers a non-administrator with 404 rather than 403, so
   * nothing about this route is confirmed to somebody who may not use it. The
   * service refuses independently — see `AuditService.query` for why it is
   * checked in both places and why the two refusals differ.
   *
   * @param actor - who is asking, as the guard's strategy established them
   * @param query - which page is wanted, and how to narrow it
   * @returns the page, with the totals a caller needs
   */
  @Get()
  public async list(
    @CurrentUser() actor: AuthenticatedActor,
    @Query() query: AuditQueryDto,
  ): Promise<PaginatedResponse<AuditEntryJSON>> {
    const page = await this.audit.query(actor.userId, {
      page: query.page,
      limit: query.limit,
      // Spread would put `actorId: undefined` on the object for an omitted
      // filter, and an explicit `undefined` is not the same as an absent key to
      // the store underneath. Built key by key instead.
      ...(query.actorId === undefined ? {} : { actorId: query.actorId as UserId }),
      ...(query.action === undefined ? {} : { action: query.action }),
    });

    return { data: page.data.map((entry) => entry.toJSON()), meta: page.meta };
  }
}
