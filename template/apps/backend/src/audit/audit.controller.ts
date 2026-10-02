import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import type { AuditEntryJSON } from '__FORGE_SCOPE__/core/audit/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import type { PaginatedResponse } from '../common/types';
import { CurrentUser } from '../auth/decorators';
import type { Request } from 'express';
import { PLATFORM_ADMIN_PASS, PlatformAdminGuard, type PlatformAdminPass } from '../auth/guards';
import type { AuthenticatedActor } from '../auth/strategies';
import { AuditService } from './audit.service';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiPropertyOptional()
  readonly page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional()
  readonly limit: number = 20;

  /** Only entries this person is recorded as the actor of. */
  @IsOptional()
  @IsUUID()
  readonly actorId?: string;

  /** Only entries recording this kind of action. */
  @IsOptional()
  @IsEnum(AuditAction)
  readonly action?: AuditAction;

  /**
   * Only entries that had already happened at this instant.
   *
   * A caller does not invent this value: it takes `meta.asOf` off the first
   * page and sends it back with every later one, which is what holds a whole
   * traversal to one world. `@Type(() => Date)` because a query string carries
   * text and `AuditQuery.asOf` is a `Date`; `@IsDate` then refuses text that is
   * not one, rather than letting an `Invalid Date` reach the store and narrow to
   * nothing without saying so.
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  readonly asOf?: Date;
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
 * every read of the history adds an entry to the history. ADR-0006 requires
 * every platform-administrative pass to be logged and this is exactly such a
 * pass, so the entry is owed. Carving out an exception here — "except when the
 * thing being read is the log itself" — would be the one exception nobody
 * auditing the deployment would think to look for.
 *
 * **What it cost, and what each remedy actually fixed.** Three consequences, all
 * three measured rather than deduced, and each now asserted in
 * `__tests__/audit.controller.spec.ts`:
 *
 * 1. **A read's own entry was in the page that read returned** — the newest row
 *    of page 1 was always the request that had asked for it. Found as a test
 *    expecting three entries and receiving four. **Fixed** by moving the write
 *    from `PlatformAdminGuard` to `PlatformAdminOverrideInterceptor`, which runs
 *    after the handler. Nothing about what is recorded changed.
 * 2. **Page 2 repeated the last row of page 1**, once per intervening read. The
 *    interceptor does not fix this and cannot: a traversal spans several
 *    requests, and each one appends before the next one asks. **Fixed** by
 *    `AuditQuery.asOf`, an upper bound every page of one traversal shares —
 *    which also makes the sequence stable against any *other* concurrent writer,
 *    which the interceptor could never have done. This endpoint echoes the bound
 *    back as `meta.asOf` so a caller has something to send, rather than having to
 *    invent an instant and hope it is the right one.
 * 3. **Anything that polls this endpoint writes to it at the polling rate**, for
 *    ever, into a table whose role has `DELETE` revoked. Not fixed, and not
 *    fixable here: it is a retention question, and retention on an append-only
 *    table is a decision about the deployment rather than about this route.
 *
 * The two remedies are for two different problems and neither replaces the
 * other. A caller that pages without `asOf` still sees a repeated row; a caller
 * that uses it sees a stable window whoever else is writing.
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
    @Req() request: Request & { [PLATFORM_ADMIN_PASS]?: PlatformAdminPass },
  ): Promise<PaginatedResponse<AuditEntryJSON> & { meta: { asOf: string } }> {
    const page = await this.audit.query(actor.userId, {
      page: query.page,
      limit: query.limit,
      // Spread would put `actorId: undefined` on the object for an omitted
      // filter, and an explicit `undefined` is not the same as an absent key to
      // the store underneath. Built key by key instead.
      ...(query.asOf === undefined ? {} : { asOf: query.asOf }),
      ...(query.actorId === undefined ? {} : { actorId: query.actorId as UserId }),
      ...(query.action === undefined ? {} : { action: query.action }),
    });

    const bound = AuditController.boundFor(query, page.data, request[PLATFORM_ADMIN_PASS]);
    return {
      data: page.data.map((entry) => entry.toJSON()),
      // Echoed back, as an instant on the wire. It is `meta` and not a header
      // because it is part of the answer: "this is the world these totals were
      // counted in", and a caller that drops it gets a different world next page.
      meta: { ...page.meta, asOf: bound.toISOString() },
    };
  }

  /**
   * The bound a caller should send with the rest of their traversal.
   *
   * A caller who brought one keeps it — a traversal is one world, and a bound
   * that moved between pages would be no bound at all.
   *
   * A caller who did not gets **the instant of the newest entry on this page**,
   * and that choice is the whole of why this works. The obvious default is "now",
   * and "now" is wrong here in a way that is easy to miss: this request records
   * its own `PLATFORM_ADMIN_OVERRIDE`, stamped when the guard passed, which is
   * *before* any "now" the handler could read. So the traversal's own first entry
   * would fall inside its own bound, appear on page 2, and push exactly the row
   * the bound existed to hold still. Measured — page 3 of 3 came back with a
   * duplicate and a total of 4.
   *
   * Taking it from the data invents no instant, needs no arbitrary offset, and is
   * exact rather than probabilistic: everything this traversal goes on to record
   * is newer than every row it has already been shown, so all of it is outside.
   *
   * **An empty page has no entry to take one from, and `new Date()` is wrong
   * there for exactly the reason it is wrong everywhere else** — it is read in
   * the handler, after the guard stamped this request's own override, so a
   * caller who filtered their first page down to nothing and then widened it
   * would be handed a bound that includes the read they just made. That is the
   * original defect surviving in the one branch nobody asserted, which is why
   * this branch now has a test of its own.
   *
   * What it answers instead is the last instant that certainly precedes anything
   * this request can have caused: one millisecond before the guard passed. The
   * millisecond is the column's own resolution, and it costs nothing here —
   * the page it applies to is empty by definition, so there is no entry in that
   * millisecond to lose.
   *
   * With no pass on the request there is no override to exclude, so the request
   * instant is exact rather than merely harmless. That is the unguarded case,
   * which does not arise on this route today and would be somebody's mistake if
   * it did.
   *
   * @param query - what the caller asked for
   * @param data - the entries this page answered with, newest first
   * @param pass - the platform-administrative pass this request made, if any
   * @returns the bound to echo
   */
  private static boundFor(
    query: AuditQueryDto,
    data: { occurredAt: Date }[],
    pass?: PlatformAdminPass,
  ): Date {
    if (query.asOf !== undefined) return query.asOf;
    if (data.length > 0) return data[0].occurredAt;
    if (pass === undefined) return new Date();
    return new Date(pass.occurredAt.getTime() - 1);
  }
}
